package pluginsvc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/adapters/pluginstate"
)

type stagingRecoveryFixture struct {
	service          *PluginService
	source           string
	tx               installTransaction
	target           string
	candidate        string
	backup           string
	workspace        string
	previousIdentity string
	approval         []byte
}

func TestStagingRecoveryReconstructsFromRealSQLiteCrashStates(t *testing.T) {
	for _, test := range []struct {
		name  string
		stage func(*testing.T, stagingRecoveryFixture)
	}{
		{name: "after staging publication"},
		{name: "after workspace mkdir", stage: func(t *testing.T, fixture stagingRecoveryFixture) {
			if err := os.MkdirAll(fixture.workspace, 0o700); err != nil {
				t.Fatal(err)
			}
		}},
		{name: "mid copy", stage: func(t *testing.T, fixture stagingRecoveryFixture) {
			if err := os.MkdirAll(fixture.candidate, 0o700); err != nil {
				t.Fatal(err)
			}
			copyTestFile(t, filepath.Join(fixture.source, "manifest.json"), filepath.Join(fixture.candidate, "manifest.json"))
		}},
		{name: "after receipt", stage: func(t *testing.T, fixture stagingRecoveryFixture) {
			if err := copyPreparedPackage(context.Background(), fixture.source, fixture.candidate); err != nil {
				t.Fatal(err)
			}
			contentHash, err := ContentHash(fixture.candidate)
			if err != nil {
				t.Fatal(err)
			}
			if err := WriteInstallRecord(fixture.candidate, InstallRecord{
				Source: PluginSource{Kind: "path", Name: "crash-fixture"}, Version: "2.0.0", ContentHash: contentHash, Tier: TierDev,
			}); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := newStagingRecoveryFixture(t)
			if test.stage != nil {
				test.stage(t, fixture)
			}
			service := restartPluginService(t, fixture.service)
			if err := service.RecoverInstallations(); err != nil {
				t.Fatal(err)
			}
			assertStagingRecoveryRestored(t, service, fixture)
			if err := service.RecoverInstallations(); err != nil {
				t.Fatalf("repeated recovery: %v", err)
			}
		})
	}
}

func TestPreparedPublicationReconcilesBeforeAnyTargetMove(t *testing.T) {
	for _, test := range []struct {
		name         string
		faults       func(pluginStateStore) *faultPluginState
		wantRecovery bool
	}{
		{name: "prior", faults: func(state pluginStateStore) *faultPluginState {
			return &faultPluginState{pluginStateStore: state, failAt: map[int64]bool{1: true}}
		}},
		{name: "intended", wantRecovery: true, faults: func(state pluginStateStore) *faultPluginState {
			return &faultPluginState{pluginStateStore: state, uncertainAt: map[int64]bool{1: true}}
		}},
		{name: "unknown", wantRecovery: true, faults: func(state pluginStateStore) *faultPluginState {
			return &faultPluginState{
				pluginStateStore: state, uncertainAt: map[int64]bool{1: true},
				listErrAfterUncertain: errors.New("injected failed authoritative readback"),
			}
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			service, source := installedReplacementFixture(t)
			previousIdentity := mustArtifactIdentity(t, filepath.Join(service.dir, "replace-me"))
			approval := writeApprovalSentinel(t, service)
			faults := test.faults(service.state)
			service.state = faults
			renameCalls := 0
			service.installRename = func(source, destination string) error {
				renameCalls++
				return os.Rename(source, destination)
			}

			result, err := prepareAndConfirmForTest(t, service, InstallCandidate{Kind: "link", Locator: source})
			if err == nil || result.PluginID != "" {
				t.Fatalf("ConfirmInstall = %+v, %v", result, err)
			}
			if got := userErrorCode(err) == "install-recovery-required"; got != test.wantRecovery {
				t.Fatalf("recovery-required = %v, want %v (%v)", got, test.wantRecovery, err)
			}
			if renameCalls != 0 {
				t.Fatalf("target move calls = %d", renameCalls)
			}
			if identity := mustArtifactIdentity(t, filepath.Join(service.dir, "replace-me")); identity != previousIdentity {
				t.Fatalf("previous package changed before authoritative prepared success: %q", identity)
			}

			service = restartPluginService(t, service)
			if err := service.RecoverInstallations(); err != nil {
				t.Fatal(err)
			}
			if identity := mustArtifactIdentity(t, filepath.Join(service.dir, "replace-me")); identity != previousIdentity {
				t.Fatalf("previous package changed after recovery: %q", identity)
			}
			assertApprovalBytes(t, service, approval)
			assertNoInstallTransactions(t, service)
		})
	}
}

func TestStagingCleanupFailureRetainsRowAndRetriesIdempotently(t *testing.T) {
	fixture := newStagingRecoveryFixture(t)
	if err := os.MkdirAll(fixture.candidate, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(fixture.candidate, "partial.js"), []byte("partial"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := restartPluginService(t, fixture.service)
	service.installRootRemoveAll = func(*os.Root, string) error { return errors.New("injected staging cleanup failure") }
	if err := service.RecoverInstallations(); userErrorCode(err) != "install-recovery-required" {
		t.Fatalf("RecoverInstallations error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(fixture.candidate, "partial.js")); err != nil {
		t.Fatalf("failed cleanup did not retain scratch: %v", err)
	}
	records, err := service.state.ListInstallTransactions(context.Background())
	if err != nil || len(records) != 1 {
		t.Fatalf("retained rows = %+v, %v", records, err)
	}
	service.installRootRemoveAll = (*os.Root).RemoveAll
	if err := service.RecoverInstallations(); err != nil {
		t.Fatal(err)
	}
	if err := service.RecoverInstallations(); err != nil {
		t.Fatalf("repeated recovery: %v", err)
	}
	assertStagingRecoveryRestored(t, service, fixture)
}

func TestStagingRecoveryPreservesUnexpectedEvidence(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*testing.T, stagingRecoveryFixture) string
	}{
		{name: "extra workspace entry", mutate: func(t *testing.T, fixture stagingRecoveryFixture) string {
			if err := os.MkdirAll(fixture.workspace, 0o700); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(fixture.workspace, "unrecognized")
			if err := os.WriteFile(path, []byte("evidence"), 0o600); err != nil {
				t.Fatal(err)
			}
			return path
		}},
		{name: "changed target", mutate: func(t *testing.T, fixture stagingRecoveryFixture) string {
			path := filepath.Join(fixture.target, "main.js")
			if err := os.WriteFile(path, []byte("changed during crash"), 0o600); err != nil {
				t.Fatal(err)
			}
			return path
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := newStagingRecoveryFixture(t)
			evidence := test.mutate(t, fixture)
			service := restartPluginService(t, fixture.service)
			if err := service.RecoverInstallations(); userErrorCode(err) != "install-recovery-required" {
				t.Fatalf("RecoverInstallations error = %v", err)
			}
			if _, err := os.Lstat(evidence); err != nil {
				t.Fatalf("recovery removed unexpected evidence: %v", err)
			}
			records, err := service.state.ListInstallTransactions(context.Background())
			if err != nil || len(records) != 1 {
				t.Fatalf("retained rows = %+v, %v", records, err)
			}
		})
	}
}

func TestUnknownWorkspaceWithoutRowIsPreserved(t *testing.T) {
	service := New(t.TempDir(), nil, "")
	root, err := service.canonicalPluginRoot()
	if err != nil {
		t.Fatal(err)
	}
	workspace := filepath.Join(transactionWorkspaceRoot(root), "0123456789abcdef0123456789abcdef")
	if err := os.MkdirAll(workspace, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := service.RecoverInstallations(); userErrorCode(err) != "install-recovery-required" {
		t.Fatalf("RecoverInstallations error = %v", err)
	}
	if _, err := os.Stat(workspace); err != nil {
		t.Fatalf("unknown workspace was removed: %v", err)
	}
}

func TestRecoveryFailureDeniesDiscoveryAndRuntimePredicates(t *testing.T) {
	fixture := newStagingRecoveryFixture(t)
	if err := os.WriteFile(filepath.Join(fixture.target, "main.js"), []byte("changed during crash"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := restartPluginService(t, fixture.service)
	if _, err := service.ListPlugins(); userErrorCode(err) != "install-recovery-required" {
		t.Fatalf("ListPlugins error = %v", err)
	}
	if _, err := service.ListUpdates(); userErrorCode(err) != "install-recovery-required" {
		t.Fatalf("ListUpdates error = %v", err)
	}
	if service.PolicyAllows("replace-me") {
		t.Fatal("PolicyAllows accepted a package with unresolved recovery")
	}
	if service.SignedOK("replace-me") {
		t.Fatal("SignedOK accepted a package with unresolved recovery")
	}
	if service.ContentHashOf("replace-me") != "" || service.CodeHashOf("replace-me") != "" || service.VersionOf("replace-me") != "" {
		t.Fatal("package identity escaped unresolved recovery")
	}
	if !service.Widened("replace-me") {
		t.Fatal("bulk authority comparison did not hold unresolved recovery")
	}
	if _, err := service.PreviewInstalled("replace-me"); err == nil {
		t.Fatal("installed preview ignored unresolved recovery")
	}
}

func TestDecodeInstallTransactionRejectsMixedStagingShapes(t *testing.T) {
	fixture := newStagingRecoveryFixture(t)
	base := fixture.tx
	base.Revision = 0
	for _, test := range []struct {
		name   string
		mutate func(*installTransaction)
	}{
		{name: "staging candidate identity", mutate: func(tx *installTransaction) { tx.CandidateArtifactIdentity = "unexpected" }},
		{name: "staging receipt", mutate: func(tx *installTransaction) { tx.Record.Version = tx.ExpectedVersion }},
		{name: "prepared missing candidate identity", mutate: func(tx *installTransaction) { tx.Phase = "prepared" }},
		{name: "missing reviewed identity", mutate: func(tx *installTransaction) { tx.ReviewedArtifactIdentity = "" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			tx := base
			test.mutate(&tx)
			payload, err := json.Marshal(tx)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := fixture.service.decodeInstallTransaction(pluginstate.InstallTransactionRecord{ID: tx.TransactionID, Revision: 1, Payload: payload}); err == nil {
				t.Fatal("mixed transaction shape decoded")
			}
		})
	}
}

func newStagingRecoveryFixture(t *testing.T) stagingRecoveryFixture {
	t.Helper()
	service, source := installedReplacementFixture(t)
	target := filepath.Join(service.dir, "replace-me")
	previousIdentity := mustArtifactIdentity(t, target)
	reviewedIdentity := mustArtifactIdentity(t, source)
	approval := writeApprovalSentinel(t, service)
	canonicalRoot, err := service.canonicalPluginRoot()
	if err != nil {
		t.Fatal(err)
	}
	transactionID, err := randomInstallID()
	if err != nil {
		t.Fatal(err)
	}
	tx := installTransaction{
		Version: installTransactionVersion, TransactionID: transactionID, PluginID: "replace-me", CanonicalRoot: canonicalRoot,
		HadPrevious: true, PreviousArtifactIdentity: previousIdentity, ReviewedArtifactIdentity: reviewedIdentity,
		ExpectedVersion: "2.0.0", Replace: true, Phase: "staging",
	}
	if err := service.publishInstallTransaction(&tx); err != nil {
		t.Fatal(err)
	}
	gotTarget, candidate, backup, workspace, err := service.transactionPaths(tx)
	if err != nil {
		t.Fatal(err)
	}
	return stagingRecoveryFixture{
		service: service, source: source, tx: tx, target: gotTarget, candidate: candidate, backup: backup,
		workspace: workspace, previousIdentity: previousIdentity, approval: approval,
	}
}

func restartPluginService(t *testing.T, service *PluginService) *PluginService {
	t.Helper()
	dir := service.dir
	if err := service.state.Close(); err != nil {
		t.Fatal(err)
	}
	return New(dir, nil, "")
}

func writeApprovalSentinel(t *testing.T, service *PluginService) []byte {
	t.Helper()
	want := []byte(`{"version":1,"initialized":true,"allowed":["replace-me"],"locks":{"replace-me":{"version":"1.0.0","hash":"retained-hash"}},"legacyUnpinned":[]}`)
	got, _, err := UpdateApprovalState(service,
		func() ([]byte, error) { return append([]byte(nil), want...), nil },
		func([]byte) ([]byte, error) { return append([]byte(nil), want...), nil },
	)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func assertStagingRecoveryRestored(t *testing.T, service *PluginService, fixture stagingRecoveryFixture) {
	t.Helper()
	if identity := mustArtifactIdentity(t, fixture.target); identity != fixture.previousIdentity {
		t.Fatalf("previous package identity = %q, want %q", identity, fixture.previousIdentity)
	}
	installed, err := os.ReadFile(filepath.Join(fixture.target, "main.js"))
	if err != nil || string(installed) != "old bytes" {
		t.Fatalf("installed bytes = %q, %v", installed, err)
	}
	assertApprovalBytes(t, service, fixture.approval)
	assertNoInstallTransactions(t, service)
	assertNoTransactionWorkspaceEntries(t, fixture.tx.CanonicalRoot)
}

func assertApprovalBytes(t *testing.T, service *PluginService, want []byte) {
	t.Helper()
	got, _, present, err := LoadApprovalState(service)
	if err != nil || !present || !bytes.Equal(got, want) {
		t.Fatalf("approval state = %q, present %v, error %v; want %q", got, present, err, want)
	}
}

func mustArtifactIdentity(t *testing.T, path string) string {
	t.Helper()
	identity, err := completeArtifactIdentity(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	return identity
}

func assertNoTransactionWorkspaceEntries(t *testing.T, canonicalRoot string) {
	t.Helper()
	entries, err := os.ReadDir(transactionWorkspaceRoot(canonicalRoot))
	if os.IsNotExist(err) {
		return
	}
	if err != nil || len(entries) != 0 {
		t.Fatalf("transaction workspace entries = %v, %v", entries, err)
	}
}

func copyTestFile(t *testing.T, source, destination string) {
	t.Helper()
	raw, err := os.ReadFile(source) // #nosec G304 -- source is a test-owned temporary file
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(destination, raw, 0o600); err != nil { // #nosec G703 -- destination is a test-owned transaction path
		t.Fatal(err)
	}
}
