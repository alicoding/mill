package backupsvc

import (
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/zalando/go-keyring"
)

// TestMain mirrors configureservice_test.go's own setup: ConfigureService
// construction touches internal/adapters/credential, which isn't
// CI-testable against the real OS keychain.
func TestMain(m *testing.M) {
	keyring.MockInit()
	m.Run()
}

// newTestExecutionHarness builds a real CompositionService/
// GuardrailService/ExecutionService backed by a real, on-disk sqlite
// file -- the exact same construction shape executionsvc's own
// codeexec_seed_test.go uses (newTestExecutionService), reused here so
// the concurrency proof below exercises the real DBOS/sqlite
// checkpointing path a live workflow run actually takes, not a fake.
func newTestExecutionHarness(t *testing.T) (*executionsvc.ExecutionService, *compositionsvc.CompositionService, string) {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "execution.db")
	exec, err := executionsvc.NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })
	return exec, comp, dbPath
}

// TestBackupService_SnapshotSafeWhileASeededWorkflowRunConcurrentlyExecutes
// is this goal's service-layer concurrency proof (docs/goals/0065's own
// acceptance criterion: "a snapshot taken while runs execute"): a real
// ExecutionService keeps running a workflow (real DBOS checkpoint
// writes into the same sqlite file) while BackupNow takes several
// snapshots, none of which may fail or corrupt.
func TestBackupService_SnapshotSafeWhileASeededWorkflowRunConcurrentlyExecutes(t *testing.T) {
	exec, comp, dbPath := newTestExecutionHarness(t)

	outPath := filepath.Join(t.TempDir(), "out.txt")
	nodes := []composition.Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "w", NodeTypeID: "apply-file-write", Config: map[string]string{"path": outPath, "mode": "append"}},
	}
	edges := []composition.Edge{{ID: "e1", Source: "t", Target: "w"}}
	wf, err := comp.CreateWorkflow("Concurrency proof", "", nodes, edges)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	backupDir := t.TempDir()
	svc := New(dbPath, "", "", backupDir, "test")

	stop := make(chan struct{})
	var runErr error
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
			}
			if _, err := exec.RunWorkflow(wf.ID, executionsvc.RunKindTest, nil); err != nil {
				runErr = err
				return
			}
		}
	}()

	for i := 0; i < 3; i++ {
		if _, err := svc.BackupNow(5); err != nil {
			close(stop)
			wg.Wait()
			t.Fatalf("BackupNow #%d while runs execute: %v", i, err)
		}
		// Real "Back up now" clicks are never sub-millisecond apart --
		// this paces the 3 calls past TimestampLayout's own millisecond
		// resolution so each lands in its own backup subdirectory, while
		// the workflow-run goroutine above keeps hammering the same
		// database file the entire time regardless.
		time.Sleep(2 * time.Millisecond)
	}
	close(stop)
	wg.Wait()

	if runErr != nil {
		t.Fatalf("concurrent RunWorkflow failed: %v", runErr)
	}
	status, err := svc.GetBackupStatus()
	if err != nil {
		t.Fatalf("GetBackupStatus: %v", err)
	}
	if !status.HasBackup {
		t.Error("GetBackupStatus().HasBackup = false after 3 successful BackupNow calls")
	}
}

func TestBackupService_BackupNow_UnavailableForNonSqliteDeployment(t *testing.T) {
	svc := New("", "", "", t.TempDir(), "test")
	if _, err := svc.BackupNow(5); err == nil {
		t.Error("BackupNow with no dbPath (a BYO-Postgres deployment) = nil error, want a clear unavailable error")
	}
}

func TestBackupService_GetBackupStatus_ReflectsNoBackupYet(t *testing.T) {
	svc := New("", "", "", t.TempDir(), "test")
	status, err := svc.GetBackupStatus()
	if err != nil {
		t.Fatalf("GetBackupStatus: %v", err)
	}
	if status.HasBackup {
		t.Error("GetBackupStatus().HasBackup = true before any backup ran")
	}
}

func TestBackupService_RevealBackupFolder_NoAppIsANoOp(t *testing.T) {
	// application.Get() returns nil under `go test` (no real Wails
	// application ever constructed) -- same defensive guard
	// dataevent.Emit's own doc comment documents.
	svc := New("", "", "", t.TempDir(), "test")
	if err := svc.RevealBackupFolder(); err != nil {
		t.Errorf("RevealBackupFolder() with no running application = %v, want nil (silent no-op)", err)
	}
}

// TestExportEverything_RoundTripsEveryFamilyIntoAFreshInstance is this
// goal's export-everything acceptance criterion: an archive built from
// one instance, imported into a completely separate, empty instance,
// restores every bundled family (Go test, per docs/goals/0065's own
// acceptance bar).
func TestExportEverything_RoundTripsEveryFamilyIntoAFreshInstance(t *testing.T) {
	sourceStore := servicetest.NewFakeStore()
	sourceComp := compositionsvc.NewCompositionService(sourceStore)
	sourceCfg := configuresvc.NewConfigureService(sourceStore, sourceComp, credential.New())
	sourceAtlas := atlassvc.NewAtlasService(sourceStore)

	nodes := []composition.Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "c", NodeTypeID: "capture-clipboard-html"},
	}
	edges := []composition.Edge{{ID: "e1", Source: "t", Target: "c"}}
	wf, err := sourceComp.CreateWorkflow("Round-trip workflow", "exported then imported", nodes, edges)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	req, err := sourceCfg.CreateHTTPRequest("Round-trip request", "https://example.com", "GET", "", "none", "", nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	kind, err := sourceAtlas.CreateKind("Round-trip kind", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}

	source := New("", "", "", t.TempDir(), "test")
	source.SetFamilies(BuildFamilies(sourceComp, sourceCfg))
	source.SetAtlasBundle(WireAtlasBundle(sourceAtlas))

	archive, err := source.ExportEverything()
	if err != nil {
		t.Fatalf("ExportEverything: %v", err)
	}

	destStore := servicetest.NewFakeStore()
	destComp := compositionsvc.NewCompositionService(destStore)
	destCfg := configuresvc.NewConfigureService(destStore, destComp, credential.New())
	destAtlas := atlassvc.NewAtlasService(destStore)

	dest := New("", "", "", t.TempDir(), "test")
	dest.SetFamilies(BuildFamilies(destComp, destCfg))
	dest.SetAtlasBundle(WireAtlasBundle(destAtlas))

	preview, err := dest.PreviewImportEverything(archive)
	if err != nil {
		t.Fatalf("PreviewImportEverything: %v", err)
	}
	if len(preview.Families) == 0 {
		t.Fatal("PreviewImportEverything reported no families, want workflows+requests present")
	}
	// Only workflows/requests got a genuinely NEW entity above (created
	// with a fresh, unseen id) -- lists/mcpservers/decisions/aiproviders/
	// atlas are otherwise identical seeded content on both sides, so
	// those families are legitimately all-Updated, not all-Created.
	for _, name := range []string{"workflows", "requests"} {
		fs, ok := familyByName(preview.Families, name)
		if !ok {
			t.Fatalf("preview has no %q family, want it present", name)
		}
		if fs.Created == 0 {
			t.Errorf("preview family %q: Created = 0, want > 0 (the freshly created round-trip entity has no matching local id yet)", name)
		}
	}

	summary, err := dest.ImportEverything(archive)
	if err != nil {
		t.Fatalf("ImportEverything: %v", err)
	}
	if len(summary.Families) != len(preview.Families) {
		t.Errorf("ImportEverything summary has %d families, preview had %d", len(summary.Families), len(preview.Families))
	}

	found := false
	for _, w := range destComp.Workflows() {
		if w.ID == wf.ID {
			found = true
		}
	}
	if !found {
		t.Errorf("imported workflow %q not found in the fresh instance", wf.ID)
	}

	reqFound := false
	for _, r := range destCfg.HTTPRequests() {
		if r.ID == req.ID {
			reqFound = true
		}
	}
	if !reqFound {
		t.Errorf("imported request %q not found in the fresh instance", req.ID)
	}

	kindFound := false
	for _, k := range destAtlas.Kinds() {
		if k.ID == kind.ID {
			kindFound = true
		}
	}
	if !kindFound {
		t.Errorf("imported atlas kind %q not found in the fresh instance", kind.ID)
	}
}

func familyByName(families []FamilySummary, name string) (FamilySummary, bool) {
	for _, fs := range families {
		if fs.Name == name {
			return fs, true
		}
	}
	return FamilySummary{}, false
}
