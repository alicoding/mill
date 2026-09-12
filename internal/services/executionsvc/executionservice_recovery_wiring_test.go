package executionsvc

import (
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/dataownership"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

func TestPreparedRuntimeWaitsForHostWiringBeforeRecoveringBodies(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	storeA := servicetest.NewFakeStore()
	compA := compositionsvc.NewCompositionService(storeA)
	guardA := guardrailsvc.NewGuardrailService(storeA, compA)
	execA, err := NewExecutionServiceWithVersion("sqlite:"+dbPath, "recovery-wiring", compA, guardA)
	if err != nil {
		t.Fatalf("NewExecutionServiceWithVersion(first runtime): %v", err)
	}
	firstRuntimeActive := true
	t.Cleanup(func() {
		if !firstRuntimeActive {
			return
		}
		cleanupProviderTestRuns(t, execA)
		_ = execA.Shutdown(2 * time.Second)
	})
	wf, err := compA.CreateWorkflow("Recovered host wiring", "", []composition.Node{
		{ID: "trigger", NodeTypeID: "trigger-manual"},
		{ID: "approval", NodeTypeID: "test-external-echo"},
		{ID: "shell", NodeTypeID: "process-shell-command"},
		{ID: "atlas", NodeTypeID: "apply-atlas-card-create", Config: map[string]string{
			"kindId": "atlas-kind-intake", "title": "Recovered card", "fieldBindings": "{}",
		}},
		{ID: "notify", NodeTypeID: "apply-notify", Config: map[string]string{
			"title": "Recovered run", "body": "Host wiring was ready.",
		}},
	}, []composition.Edge{
		{ID: "to-approval", Source: "trigger", Target: "approval"},
		{ID: "to-shell", Source: "approval", Target: "shell"},
		{ID: "to-atlas", Source: "shell", Target: "atlas"},
		{ID: "to-notify", Source: "atlas", Target: "notify"},
	})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	// test-external-echo appends an unquoted [external-executed] marker to
	// the payload. Use POSIX sh so that unmatched brackets stay literal.
	t.Setenv("SHELL", "/bin/sh")
	summary, err := execA.RunWorkflowWithPayload(wf.ID, RunKindTest, nil, `echo "$MILL_RECOVERY_TOKEN"`)
	if err != nil {
		t.Fatalf("RunWorkflowWithPayload: %v", err)
	}
	runID := summary.RunID
	waitFor(t, "first runtime to park", 10*time.Second, func() (bool, bool) {
		_, listening := execA.parkedRuns.Load(runID)
		return listening, listening
	})
	if err := execA.Shutdown(2 * time.Second); err != nil {
		t.Fatalf("Shutdown first runtime: %v", err)
	}
	firstRuntimeActive = false

	storeB := servicetest.NewFakeStore()
	compB := compositionsvc.NewCompositionService(storeB)
	guardB := guardrailsvc.NewGuardrailService(storeB, compB)
	if _, err := guardB.CreateRule(guardrail.Rule{
		Label: "Allow recovered shell fixture", Effect: guardrail.EffectAllow, NodeTypeID: "process-shell-command",
	}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}
	execB, err := PrepareExecutionServiceWithVersionAndOwnership(
		"sqlite:"+dbPath,
		"recovery-wiring",
		dataownership.ExecutionOwnershipUnestablished,
		compB,
		guardB,
	)
	if err != nil {
		t.Fatalf("PrepareExecutionServiceWithVersionAndOwnership: %v", err)
	}
	launched := false
	t.Cleanup(func() {
		if launched {
			cleanupProviderTestRuns(t, execB)
		}
		_ = execB.Shutdown(2 * time.Second)
		composition.SetShellSecretResolver(func(string, string, composition.SecretAccessRun) (string, composition.SecretSource, bool) {
			return "", "", false
		})
		composition.SetAtlasCardCreator(func(kindID, title string, fields map[string]string, sourceRunID string) (composition.AtlasCard, error) {
			return composition.AtlasCard{}, fmt.Errorf("no atlas card creator registered (yet) for kind %q", kindID)
		})
		composition.SetNotifier(func(string, string, string, []string) error {
			return fmt.Errorf("no notifier registered (yet)")
		})
	})

	secretReads := make(chan composition.SecretAccessRun, 4)
	cardCreates := make(chan string, 4)
	notifications := make(chan string, 4)
	completed := make(chan string, 4)
	events := make(chan SystemEvent, 4)
	composition.SetShellSecretResolver(func(name, _ string, run composition.SecretAccessRun) (string, composition.SecretSource, bool) {
		if name != "MILL_RECOVERY_TOKEN" {
			return "", "", false
		}
		secretReads <- run
		return "wired-after-prepare", composition.SecretSourceVault, true
	})
	composition.SetAtlasCardCreator(func(kindID, title string, _ map[string]string, sourceRunID string) (composition.AtlasCard, error) {
		cardCreates <- sourceRunID
		return composition.AtlasCard{ID: "recovered-card", KindID: kindID, Title: title}, nil
	})
	composition.SetNotifier(func(_ string, _ string, runID string, _ []string) error {
		notifications <- runID
		return nil
	})
	execB.SetRunCompletionSink(func(completedRunID string, succeeded bool) {
		if succeeded {
			completed <- completedRunID
		}
	})
	execB.SetSystemEventSink(func(event SystemEvent) {
		if event.Event == SystemEventRunCompleted {
			events <- event
		}
	})

	select {
	case <-time.After(200 * time.Millisecond):
	case got := <-secretReads:
		t.Fatalf("prepared runtime executed a body before launch: secret read %+v", got)
	case got := <-cardCreates:
		t.Fatalf("prepared runtime executed a body before launch: card source %q", got)
	case got := <-notifications:
		t.Fatalf("prepared runtime executed a body before launch: notification run %q", got)
	case got := <-completed:
		t.Fatalf("prepared runtime completed run %q before launch", got)
	case got := <-events:
		t.Fatalf("prepared runtime emitted event %+v before launch", got)
	}
	if _, listening := execB.parkedRuns.Load(runID); listening {
		t.Fatal("prepared runtime recovered the pending body before launch")
	}

	if err := LaunchExecutionService(execB); err != nil {
		t.Fatalf("LaunchExecutionService: %v", err)
	}
	launched = true
	waitFor(t, "recovered run to park after launch", 30*time.Second, func() (bool, bool) {
		_, listening := execB.parkedRuns.Load(runID)
		return listening, listening
	})
	if err := execB.ResolveApproval(runID, "approval", true, nil, false); err != nil {
		t.Fatalf("ResolveApproval: %v", err)
	}

	secretRun := awaitRecoveryValue(t, secretReads, "runtime secret resolution")
	if secretRun.RunID != runID || secretRun.WorkflowID != wf.ID || secretRun.StepID != "shell" {
		t.Fatalf("secret access = %+v, want recovered run/workflow/shell", secretRun)
	}
	if got := awaitRecoveryCardCreation(t, execB, runID, cardCreates); got != runID {
		t.Fatalf("Atlas source run = %q, want %q", got, runID)
	}
	if got := awaitRecoveryValue(t, notifications, "notification delivery"); got != runID {
		t.Fatalf("notification run = %q, want %q", got, runID)
	}
	if got := awaitRecoveryValue(t, completed, "run completion"); got != runID {
		t.Fatalf("completion run = %q, want %q", got, runID)
	}
	if got := awaitRecoveryValue(t, events, "system event"); got.RunID != runID {
		t.Fatalf("system event run = %q, want %q", got.RunID, runID)
	}
	awaitPersistedTerminal(t, execB, runID)
	awaitNoLiveProviderBodies(t, execB)
}

func awaitRecoveryCardCreation(t *testing.T, exec *ExecutionService, runID string, values <-chan string) string {
	t.Helper()
	deadline := time.NewTimer(30 * time.Second)
	ticker := time.NewTicker(25 * time.Millisecond)
	defer deadline.Stop()
	defer ticker.Stop()
	for {
		select {
		case value := <-values:
			return value
		case <-ticker.C:
			summary, err := exec.summaryFor(runID)
			if err != nil || (summary.Status != "ERROR" && summary.Status != "CANCELLED" && summary.Status != "MAX_RECOVERY_ATTEMPTS_EXCEEDED") {
				continue
			}
			detail, detailErr := exec.GetRun(runID)
			if detailErr != nil {
				t.Fatalf("recovered run ended before Atlas card creation: status=%s error=%q; GetRun: %v", summary.Status, summary.Error, detailErr)
			}
			t.Fatalf("recovered run ended before Atlas card creation: status=%s error=%q steps=%+v", summary.Status, summary.Error, detail.Steps)
		case <-deadline.C:
			t.Fatal("timed out waiting for recovered Atlas card creation")
		}
	}
}

func awaitRecoveryValue[T any](t *testing.T, values <-chan T, what string) T {
	t.Helper()
	select {
	case value := <-values:
		return value
	case <-time.After(30 * time.Second):
		t.Fatalf("timed out waiting for recovered %s", what)
		var zero T
		return zero
	}
}
