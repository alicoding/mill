package pluginsvc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"

	"github.com/alicoding/mill/internal/adapters/pluginstate"
	"github.com/alicoding/mill/internal/domain/usererror"
)

const installTransactionVersion = 1

var installTransactionIDPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

type installTransaction struct {
	Version                   int           `json:"version"`
	TransactionID             string        `json:"transactionId"`
	PluginID                  string        `json:"pluginId"`
	CanonicalRoot             string        `json:"canonicalRoot"`
	HadPrevious               bool          `json:"hadPrevious"`
	PreviousArtifactIdentity  string        `json:"previousArtifactIdentity,omitempty"`
	ReviewedArtifactIdentity  string        `json:"reviewedArtifactIdentity"`
	CandidateArtifactIdentity string        `json:"candidateArtifactIdentity"`
	ExpectedVersion           string        `json:"expectedVersion"`
	Record                    InstallRecord `json:"record"`
	Replace                   bool          `json:"replace"`
	Phase                     string        `json:"phase"`
	Revision                  int64         `json:"-"`
}

type physicalPackageState uint8

const (
	packageAbsent physicalPackageState = iota
	packageExpected
	packageUnexpected
)

func (p *PluginService) RecoverInstallations() error {
	p.installMu.Lock()
	defer p.installMu.Unlock()
	return p.recoverInstallationsLocked()
}

func WithPluginMutation(p *PluginService, id string, action func(dir string, builtin bool, found bool) error) error {
	p.installMu.Lock()
	defer p.installMu.Unlock()
	if err := p.recoverInstallationsLocked(); err != nil {
		return err
	}
	info, found := p.resolvePluginLocked(id)
	return action(info.Dir, info.Builtin, found)
}

func (p *PluginService) recoverInstallationsLocked() error {
	records, err := p.state.ListInstallTransactions(context.Background())
	if err != nil {
		return recoveryRequired(err)
	}
	transactions := make([]installTransaction, 0, len(records))
	for _, record := range records {
		tx, err := p.decodeInstallTransaction(record)
		if err != nil {
			return recoveryRequired(err)
		}
		transactions = append(transactions, tx)
	}
	for _, tx := range transactions {
		if err := p.recoverTransactionLocked(tx); err != nil {
			return recoveryRequired(err)
		}
	}
	if err := p.refuseUnknownTransactionWorkspaces(); err != nil {
		return recoveryRequired(err)
	}
	return nil
}

func (p *PluginService) decodeInstallTransaction(record pluginstate.InstallTransactionRecord) (installTransaction, error) {
	var tx installTransaction
	decoder := json.NewDecoder(strings.NewReader(string(record.Payload)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&tx); err != nil {
		return installTransaction{}, fmt.Errorf("extension install transaction %q is corrupt: %w", record.ID, err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return installTransaction{}, fmt.Errorf("extension install transaction %q has trailing data", record.ID)
	}
	root, err := p.canonicalPluginRoot()
	if err != nil {
		return installTransaction{}, err
	}
	if tx.Version != installTransactionVersion || tx.TransactionID != record.ID || !installTransactionIDPattern.MatchString(tx.TransactionID) || !pluginIDPattern.MatchString(tx.PluginID) || tx.CanonicalRoot != root || tx.ReviewedArtifactIdentity == "" || tx.ExpectedVersion == "" {
		return installTransaction{}, fmt.Errorf("extension install transaction %q has invalid identity", record.ID)
	}
	if tx.HadPrevious != (tx.PreviousArtifactIdentity != "") {
		return installTransaction{}, fmt.Errorf("extension install transaction %q has invalid previous identity", record.ID)
	}
	switch tx.Phase {
	case "staging":
		if tx.CandidateArtifactIdentity != "" || !reflect.DeepEqual(tx.Record, InstallRecord{}) {
			return installTransaction{}, fmt.Errorf("extension install transaction %q has an inconsistent staging receipt", record.ID)
		}
	case "prepared", "old-retained", "promoted", "committed":
		if tx.CandidateArtifactIdentity == "" || tx.Record.ContentHash == "" || tx.Record.Version != tx.ExpectedVersion || tx.Record.InstalledAt == "" {
			return installTransaction{}, fmt.Errorf("extension install transaction %q has an inconsistent receipt", record.ID)
		}
	default:
		return installTransaction{}, fmt.Errorf("extension install transaction %q has unknown phase", record.ID)
	}
	tx.Revision = record.Revision
	return tx, nil
}

func (p *PluginService) recoverTransactionLocked(tx installTransaction) error {
	target, candidate, backup, workspace, err := p.transactionPaths(tx)
	if err != nil {
		return err
	}
	if tx.Phase == "staging" {
		return p.recoverStagingTransaction(tx, target, backup, workspace)
	}
	targetCandidate := packageState(target, tx.CandidateArtifactIdentity, &tx.Record)
	targetPrevious := packageState(target, tx.PreviousArtifactIdentity, nil)
	candidateState := packageState(candidate, tx.CandidateArtifactIdentity, &tx.Record)
	backupState := packageState(backup, tx.PreviousArtifactIdentity, nil)

	if tx.Phase == "committed" {
		return p.recoverCommittedTransaction(tx, candidate, backup, workspace, targetCandidate, candidateState, backupState)
	}

	if tx.HadPrevious {
		candidateState, err = p.restorePreviousPackage(tx, target, candidate, backup, targetCandidate, targetPrevious, candidateState, backupState)
	} else {
		err = p.restoreFirstInstall(tx, target, targetCandidate, candidateState, backupState)
	}
	if err != nil {
		return err
	}
	if candidateState == packageExpected {
		if err := p.installRemoveAll(candidate); err != nil {
			return err
		}
	}
	return p.settleInstallTransaction(tx, workspace)
}

func (p *PluginService) recoverCommittedTransaction(tx installTransaction, candidate, backup, workspace string, targetState, candidateState, backupState physicalPackageState) error {
	invalidBackup := tx.HadPrevious && backupState == packageUnexpected || !tx.HadPrevious && backupState != packageAbsent
	if targetState != packageExpected || candidateState == packageUnexpected || invalidBackup {
		return fmt.Errorf("extension install transaction %q has unexpected committed files", tx.TransactionID)
	}
	if candidateState == packageExpected {
		if err := p.installRemoveAll(candidate); err != nil {
			return err
		}
	}
	if backupState == packageExpected {
		if err := p.installRemoveAll(backup); err != nil {
			return err
		}
	}
	return p.settleInstallTransaction(tx, workspace)
}

func (p *PluginService) restorePreviousPackage(tx installTransaction, target, candidate, backup string, targetCandidate, targetPrevious, candidateState, backupState physicalPackageState) (physicalPackageState, error) {
	switch {
	case targetPrevious == packageExpected && backupState == packageAbsent:
		if candidateState == packageUnexpected {
			return candidateState, fmt.Errorf("extension install transaction %q has an unexpected candidate", tx.TransactionID)
		}
	case targetCandidate == packageExpected && backupState == packageExpected:
		return p.rollbackPromotedReplacement(tx, target, candidate, backup, candidateState)
	case targetCandidate == packageAbsent && backupState == packageExpected:
		return p.restoreRetainedPrevious(tx, target, backup, candidateState)
	default:
		return candidateState, fmt.Errorf("extension install transaction %q cannot safely restore its previous extension", tx.TransactionID)
	}
	return candidateState, nil
}

func (p *PluginService) rollbackPromotedReplacement(tx installTransaction, target, candidate, backup string, candidateState physicalPackageState) (physicalPackageState, error) {
	if candidateState != packageAbsent {
		return candidateState, fmt.Errorf("extension install transaction %q has two candidate copies", tx.TransactionID)
	}
	if err := p.installRename(target, candidate); err != nil {
		return candidateState, err
	}
	if err := p.installRename(backup, target); err != nil {
		_ = p.installRename(candidate, target)
		return candidateState, err
	}
	return packageExpected, nil
}

func (p *PluginService) restoreRetainedPrevious(tx installTransaction, target, backup string, candidateState physicalPackageState) (physicalPackageState, error) {
	if candidateState == packageUnexpected {
		return candidateState, fmt.Errorf("extension install transaction %q has an unexpected candidate", tx.TransactionID)
	}
	return candidateState, p.installRename(backup, target)
}

func (p *PluginService) restoreFirstInstall(tx installTransaction, target string, targetState, candidateState, backupState physicalPackageState) error {
	if backupState != packageAbsent || candidateState == packageUnexpected {
		return fmt.Errorf("extension install transaction %q has unexpected first-install files", tx.TransactionID)
	}
	switch targetState {
	case packageExpected:
		return p.installRemoveAll(target)
	case packageAbsent:
		return nil
	default:
		return fmt.Errorf("extension install transaction %q found an unrelated target", tx.TransactionID)
	}
}

func (p *PluginService) recoverStagingTransaction(tx installTransaction, target, backup, workspace string) error {
	if err := p.reconcileStagingDestinations(tx, target, backup); err != nil {
		return err
	}
	workspaceRoot, workspaceInfo, err := openStableRoot(workspace)
	if os.IsNotExist(err) {
		return p.settleInstallTransaction(tx, workspace)
	}
	if err != nil {
		return err
	}
	defer func() { _ = workspaceRoot.Close() }()
	entries, err := readRootEntries(workspaceRoot)
	if err != nil {
		return err
	}
	if len(entries) == 0 {
		if err := workspaceRoot.Close(); err != nil {
			return err
		}
		return p.settleInstallTransaction(tx, workspace)
	}
	if len(entries) != 1 || entries[0].Name() != "candidate" {
		return fmt.Errorf("extension install transaction %q retained unexpected staging evidence", tx.TransactionID)
	}
	if err := p.removeStagingCandidate(tx, workspaceRoot); err != nil {
		return err
	}
	currentWorkspaceInfo, err := os.Lstat(workspace)
	if err != nil || !os.SameFile(workspaceInfo, currentWorkspaceInfo) {
		return fmt.Errorf("extension install transaction %q staging workspace changed", tx.TransactionID)
	}
	if err := workspaceRoot.Close(); err != nil {
		return err
	}
	return p.settleInstallTransaction(tx, workspace)
}

func (p *PluginService) reconcileStagingDestinations(tx installTransaction, target, backup string) error {
	if !tx.HadPrevious {
		if packageState(target, "", nil) != packageAbsent || packageState(backup, "", nil) != packageAbsent {
			return fmt.Errorf("extension install transaction %q found unexpected first-install files while staging", tx.TransactionID)
		}
		return nil
	}
	targetState := packageState(target, tx.PreviousArtifactIdentity, nil)
	backupState := packageState(backup, tx.PreviousArtifactIdentity, nil)
	switch {
	case targetState == packageExpected && backupState == packageAbsent:
		return nil
	case targetState == packageAbsent && backupState == packageExpected:
		return p.installRename(backup, target)
	default:
		return fmt.Errorf("extension install transaction %q cannot safely restore its previous extension while staging", tx.TransactionID)
	}
}

func openStableRoot(path string) (*os.Root, fs.FileInfo, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, nil, err
	}
	root, err := os.OpenRoot(path)
	if err != nil {
		return nil, nil, err
	}
	openedInfo, err := root.Stat(".")
	if err != nil || !os.SameFile(info, openedInfo) {
		_ = root.Close()
		return nil, nil, fmt.Errorf("directory changed while it was opened")
	}
	return root, info, nil
}

func readRootEntries(root *os.Root) ([]fs.DirEntry, error) {
	directory, err := root.Open(".")
	if err != nil {
		return nil, err
	}
	entries, readErr := directory.ReadDir(-1)
	closeErr := directory.Close()
	if readErr != nil {
		return nil, readErr
	}
	return entries, closeErr
}

func (p *PluginService) removeStagingCandidate(tx installTransaction, workspaceRoot *os.Root) error {
	candidateInfo, err := workspaceRoot.Lstat("candidate")
	if err != nil || !candidateInfo.IsDir() || candidateInfo.Mode()&fs.ModeSymlink != 0 {
		return fmt.Errorf("extension install transaction %q has an invalid staging candidate", tx.TransactionID)
	}
	candidateRoot, err := workspaceRoot.OpenRoot("candidate")
	if err != nil {
		return err
	}
	openedCandidateInfo, statErr := candidateRoot.Stat(".")
	if statErr != nil || !os.SameFile(candidateInfo, openedCandidateInfo) {
		_ = candidateRoot.Close()
		return fmt.Errorf("extension install transaction %q staging candidate changed", tx.TransactionID)
	}
	_, walkErr := planPreparedPackage(context.Background(), candidateRoot.FS())
	closeErr := candidateRoot.Close()
	if walkErr != nil {
		return fmt.Errorf("extension install transaction %q has invalid staging scratch: %w", tx.TransactionID, walkErr)
	}
	if closeErr != nil {
		return closeErr
	}
	currentCandidateInfo, err := workspaceRoot.Lstat("candidate")
	if err != nil || !currentCandidateInfo.IsDir() || currentCandidateInfo.Mode()&fs.ModeSymlink != 0 || !os.SameFile(candidateInfo, currentCandidateInfo) {
		return fmt.Errorf("extension install transaction %q staging candidate changed", tx.TransactionID)
	}
	if err := p.installRootRemoveAll(workspaceRoot, "candidate"); err != nil {
		return err
	}
	return nil
}

func (p *PluginService) settleInstallTransaction(tx installTransaction, workspace string) error {
	entries, err := os.ReadDir(workspace)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if len(entries) != 0 {
		return fmt.Errorf("extension install transaction %q retained unexpected evidence", tx.TransactionID)
	}
	if err := p.installRemove(workspace); err != nil && !os.IsNotExist(err) {
		return err
	}
	return p.state.DeleteInstallTransaction(context.Background(), tx.TransactionID, tx.Revision)
}

func packageState(path, expectedIdentity string, expectedRecord *InstallRecord) physicalPackageState {
	if expectedIdentity == "" {
		if _, err := os.Lstat(path); os.IsNotExist(err) {
			return packageAbsent
		}
		return packageUnexpected
	}
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return packageAbsent
	}
	if err != nil || !info.IsDir() || info.Mode()&fs.ModeSymlink != 0 {
		return packageUnexpected
	}
	identity, err := completeArtifactIdentity(context.Background(), path)
	if err != nil || identity != expectedIdentity {
		return packageUnexpected
	}
	if expectedRecord != nil {
		record, ok := ReadInstallRecord(path)
		if !ok || !reflect.DeepEqual(record, *expectedRecord) {
			return packageUnexpected
		}
	}
	return packageExpected
}

func (p *PluginService) transactionPaths(tx installTransaction) (target, candidate, backup, workspace string, err error) {
	root, err := p.canonicalPluginRoot()
	if err != nil || root != tx.CanonicalRoot {
		return "", "", "", "", fmt.Errorf("extension install transaction root changed")
	}
	workspaceRoot := transactionWorkspaceRoot(root)
	workspace = filepath.Join(workspaceRoot, tx.TransactionID)
	if filepath.Dir(workspace) != workspaceRoot {
		return "", "", "", "", fmt.Errorf("extension install transaction path is invalid")
	}
	if err := requireDirectoryOrMissing(workspaceRoot); err != nil {
		return "", "", "", "", err
	}
	if err := requireDirectoryOrMissing(workspace); err != nil {
		return "", "", "", "", err
	}
	return filepath.Join(root, tx.PluginID), filepath.Join(workspace, "candidate"), filepath.Join(workspace, "backup"), workspace, nil
}

func requireDirectoryOrMissing(path string) error {
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&fs.ModeSymlink != 0 {
		return fmt.Errorf("extension installation workspace identity is invalid")
	}
	return nil
}

func (p *PluginService) canonicalPluginRoot() (string, error) {
	abs, err := filepath.Abs(filepath.Clean(p.dir))
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		return resolved, nil
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(abs))
	if err != nil {
		if os.IsNotExist(err) {
			return abs, nil
		}
		return "", err
	}
	return filepath.Join(parent, filepath.Base(abs)), nil
}

func transactionWorkspaceRoot(canonicalRoot string) string {
	sum := sha256.Sum256([]byte(canonicalRoot))
	return filepath.Join(filepath.Dir(canonicalRoot), ".mill-plugin-transactions-"+hex.EncodeToString(sum[:8]))
}

func (p *PluginService) refuseUnknownTransactionWorkspaces() error {
	root, err := p.canonicalPluginRoot()
	if err != nil {
		return err
	}
	workspaceRoot := transactionWorkspaceRoot(root)
	if err := requireDirectoryOrMissing(workspaceRoot); err != nil {
		return err
	}
	entries, err := os.ReadDir(workspaceRoot)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(entries) > 0 {
		return fmt.Errorf("extension installation workspace contains unrecognized recovery evidence")
	}
	if err := p.installRemove(workspaceRoot); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func recoveryRequired(err error) error {
	return usererror.Wrap("install-recovery-required", "Mill could not finish restoring an extension. Its files have been kept.", err)
}
