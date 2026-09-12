package pluginsvc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"github.com/alicoding/mill/internal/domain/usererror"
)

func (p *PluginService) commitPreparedArtifact(artifact preparedArtifact) (InstallCommitResult, error) {
	p.installMu.Lock()
	defer p.installMu.Unlock()
	if err := p.recoverInstallationsLocked(); err != nil {
		return InstallCommitResult{}, err
	}
	candidate, err := p.validateCommitCandidate(artifact)
	if err != nil {
		return InstallCommitResult{}, err
	}
	tx, err := p.reserveInstallTransaction(artifact, candidate)
	if err != nil {
		return InstallCommitResult{}, err
	}
	staged, err := p.stageInstallTransaction(&tx, artifact, candidate)
	if err != nil {
		return InstallCommitResult{}, p.rollbackInstallFailure(tx, err)
	}
	if err := p.retainPreviousPackage(&tx, candidate, staged); err != nil {
		return InstallCommitResult{}, p.rollbackInstallFailure(tx, err)
	}
	if err := p.promoteCandidatePackage(&tx, candidate, staged); err != nil {
		return InstallCommitResult{}, p.rollbackInstallFailure(tx, err)
	}
	info, err := p.verifyPromotedPackage(candidate, staged)
	if err != nil {
		return InstallCommitResult{}, p.rollbackInstallFailure(tx, err)
	}
	tx.Phase = "committed"
	if err := p.publishInstallTransaction(&tx); err != nil {
		if publicationUncertain(err) {
			return InstallCommitResult{}, recoveryRequired(err)
		}
		return InstallCommitResult{}, p.rollbackInstallFailure(tx, err)
	}
	return p.finishCommittedInstall(tx, artifact, candidate, staged, info), nil
}

type commitCandidate struct {
	id                string
	manifest          Manifest
	present           bool
	installedIdentity string
	record            InstallRecord
	canonicalRoot     string
}

type stagedInstallTransaction struct {
	workspace        string
	candidatePath    string
	backupPath       string
	artifactIdentity string
	record           InstallRecord
}

func (p *PluginService) validateCommitCandidate(artifact preparedArtifact) (commitCandidate, error) {
	if artifact.expectedSource != nil {
		if err := p.validateMarketplaceSourceIdentity(artifact.expectedSource); err != nil {
			return commitCandidate{}, err
		}
	}
	currentArtifactIdentity, err := completeArtifactIdentity(context.Background(), artifact.root)
	if err != nil || currentArtifactIdentity != artifact.artifactIdentity {
		return commitCandidate{}, artifactChangedError()
	}
	id, root, err := ManifestIDIn(artifact.root)
	if err != nil || root != artifact.root || id != artifact.preview.ID {
		return commitCandidate{}, artifactChangedError()
	}
	present, installedIdentity, err := p.installedIdentityLocked(id)
	if err != nil || present != artifact.installedPresent || installedIdentity != artifact.installedArtifactIdentity {
		return commitCandidate{}, usererror.New("install-installed-changed", "This extension changed while you were reviewing it. Prepare it again to continue.")
	}
	if artifact.candidate.Kind == "theme" && present {
		return commitCandidate{}, usererror.New("theme-import-duplicate", "This theme is already imported. Remove it from Extensions before importing it again.")
	}
	manifest, err := readStagedManifest(root)
	if err != nil || manifest.ID != artifact.preview.ID || manifest.Version != artifact.preview.Version {
		return commitCandidate{}, artifactChangedError()
	}
	warnings, err := p.stagedChecksLocked(root, artifact.record)
	if err != nil {
		return commitCandidate{}, err
	}
	record := artifact.record
	record.Warnings = append([]string(nil), warnings...)
	record.Version = manifest.Version
	record.InstalledAt = time.Now().UTC().Format(time.RFC3339)
	canonicalRoot, err := p.canonicalPluginRoot()
	if err != nil {
		return commitCandidate{}, err
	}
	return commitCandidate{
		id: id, manifest: manifest, present: present, installedIdentity: installedIdentity,
		record: record, canonicalRoot: canonicalRoot,
	}, nil
}

func artifactChangedError() error {
	return usererror.New("install-artifact-changed", "This extension preview changed. Prepare it again to continue.")
}

func (p *PluginService) reserveInstallTransaction(artifact preparedArtifact, candidate commitCandidate) (installTransaction, error) {
	transactionID, err := randomInstallID()
	if err != nil {
		return installTransaction{}, err
	}
	tx := installTransaction{
		Version: installTransactionVersion, TransactionID: transactionID, PluginID: candidate.id, CanonicalRoot: candidate.canonicalRoot,
		HadPrevious: candidate.present, PreviousArtifactIdentity: candidate.installedIdentity, ReviewedArtifactIdentity: artifact.artifactIdentity,
		ExpectedVersion: candidate.record.Version, Replace: artifact.candidate.Kind != "theme", Phase: "staging",
	}
	if err := p.publishInstallTransaction(&tx); err != nil {
		if publicationUncertain(err) {
			return installTransaction{}, recoveryRequired(err)
		}
		return installTransaction{}, err
	}
	return tx, nil
}

func (p *PluginService) stageInstallTransaction(tx *installTransaction, artifact preparedArtifact, candidate commitCandidate) (stagedInstallTransaction, error) {
	workspaceRoot := transactionWorkspaceRoot(candidate.canonicalRoot)
	workspace := filepath.Join(workspaceRoot, tx.TransactionID)
	candidatePath := filepath.Join(workspace, "candidate")
	backupPath := filepath.Join(workspace, "backup")
	if err := requireDirectoryOrMissing(workspaceRoot); err != nil {
		return stagedInstallTransaction{}, err
	}
	if err := os.MkdirAll(workspaceRoot, 0o700); err != nil {
		return stagedInstallTransaction{}, err
	}
	if err := os.Mkdir(workspace, 0o700); err != nil {
		return stagedInstallTransaction{}, err
	}
	if err := copyPreparedPackage(context.Background(), artifact.root, candidatePath); err != nil {
		return stagedInstallTransaction{}, err
	}
	copiedIdentity, err := completeArtifactIdentity(context.Background(), candidatePath)
	if err != nil || copiedIdentity != artifact.artifactIdentity {
		return stagedInstallTransaction{}, artifactChangedError()
	}
	record := candidate.record
	record.ContentHash, err = ContentHash(candidatePath)
	if err != nil {
		return stagedInstallTransaction{}, err
	}
	if record.Tier == TierVerified && !p.signatureOK(candidatePath, record.ContentHash) && record.Marketplace != ReservedMarketplaceName {
		record.Tier = TierHashPinned
	}
	if err := WriteInstallRecord(candidatePath, record); err != nil {
		return stagedInstallTransaction{}, err
	}
	finalIdentity, err := completeArtifactIdentity(context.Background(), candidatePath)
	if err != nil {
		return stagedInstallTransaction{}, err
	}
	tx.CandidateArtifactIdentity = finalIdentity
	tx.Record = record
	tx.Phase = "prepared"
	if err := p.publishInstallTransaction(tx); err != nil {
		return stagedInstallTransaction{}, err
	}
	return stagedInstallTransaction{
		workspace: workspace, candidatePath: candidatePath, backupPath: backupPath,
		artifactIdentity: finalIdentity, record: record,
	}, nil
}

func (p *PluginService) retainPreviousPackage(tx *installTransaction, candidate commitCandidate, staged stagedInstallTransaction) error {
	if !candidate.present {
		return nil
	}
	target := filepath.Join(candidate.canonicalRoot, candidate.id)
	if err := p.installRename(target, staged.backupPath); err != nil {
		return err
	}
	tx.Phase = "old-retained"
	return p.publishInstallTransaction(tx)
}

func (p *PluginService) promoteCandidatePackage(tx *installTransaction, candidate commitCandidate, staged stagedInstallTransaction) error {
	target := filepath.Join(candidate.canonicalRoot, candidate.id)
	if err := p.installRename(staged.candidatePath, target); err != nil {
		return err
	}
	tx.Phase = "promoted"
	return p.publishInstallTransaction(tx)
}

func (p *PluginService) verifyPromotedPackage(candidate commitCandidate, staged stagedInstallTransaction) (PluginInfo, error) {
	target := filepath.Join(candidate.canonicalRoot, candidate.id)
	if packageState(target, staged.artifactIdentity, &staged.record) != packageExpected {
		return PluginInfo{}, fmt.Errorf("the installed extension did not match its prepared package")
	}
	info := p.scanOneWithoutApproval(candidate.id)
	if info.Error != "" || info.Manifest.Version != staged.record.Version || info.ContentHash != staged.record.ContentHash {
		return PluginInfo{}, fmt.Errorf("the installed extension could not be verified")
	}
	return info, nil
}

func (p *PluginService) finishCommittedInstall(tx installTransaction, artifact preparedArtifact, candidate commitCandidate, staged stagedInstallTransaction, info PluginInfo) InstallCommitResult {
	result := InstallCommitResult{Record: staged.record, PluginID: candidate.id, NeedsAllow: p.installedNeedsAllowLocked(info)}
	if candidate.present {
		if err := p.installRemoveAll(staged.backupPath); err != nil {
			result.RecoveryRequired = true
			return result
		}
	}
	if err := p.settleInstallTransaction(tx, staged.workspace); err != nil {
		result.RecoveryRequired = true
		return result
	}
	if artifact.update {
		if err := p.pruneInstalledUpdate(candidate.id, staged.record.Version); err != nil {
			result.CatalogWarningCode = "install-catalog-refresh-failed"
		}
	}
	return result
}

func publicationUncertain(err error) bool {
	var uncertain interface{ PublicationUncertain() bool }
	return errors.As(err, &uncertain) && uncertain.PublicationUncertain()
}

func (p *PluginService) publishInstallTransaction(tx *installTransaction) error {
	payload, err := json.Marshal(tx)
	if err != nil {
		return err
	}
	initializer, err := p.catalogInitializer()
	if err != nil {
		return err
	}
	revision, err := p.state.CompareAndSwapInstallTransaction(context.Background(), initializer, tx.TransactionID, tx.Revision, payload)
	if err != nil {
		return err
	}
	tx.Revision = revision
	return nil
}

func (p *PluginService) rollbackInstallFailure(tx installTransaction, cause error) error {
	if publicationUncertain(cause) {
		return recoveryRequired(cause)
	}
	records, listErr := p.state.ListInstallTransactions(context.Background())
	if listErr != nil {
		return recoveryRequired(fmt.Errorf("%v; read recovery record: %w", cause, listErr))
	}
	for _, record := range records {
		if record.ID != tx.TransactionID {
			continue
		}
		current, err := p.decodeInstallTransaction(record)
		if err != nil {
			return recoveryRequired(fmt.Errorf("%v; %w", cause, err))
		}
		if err := p.recoverTransactionLocked(current); err != nil {
			return recoveryRequired(fmt.Errorf("%v; %w", cause, err))
		}
		return cause
	}
	return recoveryRequired(fmt.Errorf("%v; recovery record is unavailable", cause))
}

func copyPreparedPackage(ctx context.Context, sourceDir, destination string) error {
	root, err := os.OpenRoot(sourceDir)
	if err != nil {
		return err
	}
	defer func() { _ = root.Close() }()
	entries, err := planPreparedPackage(ctx, root.FS())
	if err != nil {
		return err
	}
	if err := os.MkdirAll(destination, 0o700); err != nil {
		return err
	}
	var written int64
	for _, entry := range entries {
		target, err := safeJoin(destination, entry.rel)
		if err != nil {
			return err
		}
		if entry.directory {
			if err := os.MkdirAll(target, 0o750); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
			return err
		}
		n, err := copyFSFile(ctx, root.FS(), entry.rel, target, entry.mode, maxArchiveBytes-written)
		if err != nil {
			return err
		}
		written += n
	}
	return nil
}

func planPreparedPackage(ctx context.Context, root fs.FS) ([]folderCopyEntry, error) {
	entries := []folderCopyEntry{}
	index := newPortablePathIndex()
	var totalBytes int64
	err := fs.WalkDir(root, ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if walkErr != nil {
			return walkErr
		}
		planned, include, err := preparedPackageEntry(name, entry, index, &totalBytes)
		if err != nil {
			return err
		}
		if !include {
			return nil
		}
		entries = append(entries, planned)
		return entryLimitError(len(entries))
	})
	return entries, err
}

func preparedPackageEntry(name string, entry fs.DirEntry, index *portablePathIndex, totalBytes *int64) (folderCopyEntry, bool, error) {
	if name == "." {
		return folderCopyEntry{}, false, nil
	}
	info, err := entry.Info()
	if err != nil {
		return folderCopyEntry{}, false, err
	}
	if info.Mode()&fs.ModeSymlink != 0 || (!info.IsDir() && !info.Mode().IsRegular()) {
		return folderCopyEntry{}, false, fmt.Errorf("the prepared extension contains an unsupported file")
	}
	if info.Mode().IsRegular() {
		if info.Size() < 0 || info.Size() > maxArchiveBytes-*totalBytes {
			return folderCopyEntry{}, false, fmt.Errorf("the prepared extension is too large")
		}
		*totalBytes += info.Size()
	}
	if err := index.add(filepath.ToSlash(name), info.IsDir()); err != nil {
		return folderCopyEntry{}, false, err
	}
	return folderCopyEntry{rel: name, directory: info.IsDir(), mode: info.Mode()}, true, nil
}

func (p *PluginService) installedNeedsAllowLocked(info PluginInfo) bool {
	if p.trust == nil || info.CodeHash == "" {
		return true
	}
	approval, err := p.trust.Approval()
	if err != nil || !containsString(approval.Allowed, info.Manifest.ID) {
		return true
	}
	lock, ok := approval.Locks[info.Manifest.ID]
	if !ok {
		return !containsString(approval.LegacyUnpinned, info.Manifest.ID)
	}
	if lock.Hash != info.CodeHash {
		return !legacyGrantShape(lock.Grant) || lock.Hash != info.ContentHash
	}
	_, widened := widenedFrom(lock.Grant, currentGrant(info.Manifest))
	return widened
}

func (p *PluginService) pruneInstalledUpdate(id, installedVersion string) error {
	_, err := p.mutateState(func(state *marketplaceState) error {
		kept := make([]UpdateCandidate, 0, len(state.Updates.Candidates))
		for _, candidate := range state.Updates.Candidates {
			if candidate.ID != id || candidate.Available != installedVersion {
				kept = append(kept, candidate)
			}
		}
		state.Updates.Candidates = kept
		return nil
	})
	return err
}
