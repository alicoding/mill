package composition

import (
	"errors"
	"testing"
)

// swapBackupRunner mirrors swapExecEnvLookup/swapHTTPRequestLookup's
// own established shape (executionsvc's *_seed_test.go files):
// runBackupSnapshotFn is a package-level var with no test-scoped
// accessor, so this file owns the swap/restore discipline.
func swapBackupRunner(t *testing.T, fn func(keepN int) (string, error)) {
	t.Helper()
	original := runBackupSnapshotFn
	runBackupSnapshotFn = fn
	t.Cleanup(func() { runBackupSnapshotFn = original })
}

func TestApplyBackupSnapshot_CallsRegisteredRunnerWithDefaultKeepN(t *testing.T) {
	var gotKeepN int
	swapBackupRunner(t, func(keepN int) (string, error) {
		gotKeepN = keepN
		return "/tmp/backup-dir", nil
	})

	nodes, edges := chain("trigger-manual", "apply-backup-snapshot")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}

	out, err := ExecuteWorkflow(resolved, edges, nil, ExecuteOptions{InitialPayload: "payload stays"})
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if out != "payload stays" {
		t.Errorf("ExecuteWorkflow result = %q, want the payload passed through unchanged", out)
	}
	if gotKeepN != defaultBackupKeepN {
		t.Errorf("runner called with keepN=%d, want the default %d", gotKeepN, defaultBackupKeepN)
	}
}

func TestApplyBackupSnapshot_CustomKeepNIsPassedThrough(t *testing.T) {
	var gotKeepN int
	swapBackupRunner(t, func(keepN int) (string, error) {
		gotKeepN = keepN
		return "", nil
	})

	nodes, edges := chain("trigger-manual", "apply-backup-snapshot")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	for i := range resolved {
		if resolved[i].NodeTypeID == "apply-backup-snapshot" {
			resolved[i].Config["keepN"] = "3"
		}
	}

	if _, err := ExecuteWorkflow(resolved, edges, nil, ExecuteOptions{}); err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if gotKeepN != 3 {
		t.Errorf("runner called with keepN=%d, want the configured 3", gotKeepN)
	}
}

func TestApplyBackupSnapshot_RunnerErrorFailsTheStep(t *testing.T) {
	swapBackupRunner(t, func(int) (string, error) { return "", errors.New("disk full") })

	nodes, edges := chain("trigger-manual", "apply-backup-snapshot")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}

	if _, err := ExecuteWorkflow(resolved, edges, nil, ExecuteOptions{}); err == nil {
		t.Error("ExecuteWorkflow with a failing backup runner = nil error, want failure")
	}
}

func TestApplyBackupSnapshot_UnregisteredRunnerFailsClosed(t *testing.T) {
	// No swapBackupRunner call: exercises the package's own default
	// runBackupSnapshotFn (the error-returning stub), the state a run
	// would see if main.go somehow never called SetBackupRunner.
	original := runBackupSnapshotFn
	runBackupSnapshotFn = func(keepN int) (string, error) {
		return "", errors.New("no backup runner registered (yet)")
	}
	t.Cleanup(func() { runBackupSnapshotFn = original })

	nodes, edges := chain("trigger-manual", "apply-backup-snapshot")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}

	if _, err := ExecuteWorkflow(resolved, edges, nil, ExecuteOptions{}); err == nil {
		t.Error("ExecuteWorkflow with no backup runner registered = nil error, want fail-closed")
	}
}
