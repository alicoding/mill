package triggersvc

import (
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/clipboardhistorysvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// TestSeededClipboardHistory_TriggeredRunStoresRedactedEntry proves the
// real seeded "Clipboard history" workflow's own graph -- not a
// hand-built look-alike -- stores an entry once triggered, with a known
// secret value already redacted. Uses RunWorkflowWithPayload directly
// (the exact call fire() makes on a real trigger fire, triggerservice.go)
// rather than driving the real macOS pasteboard: goal 0234's own
// e2e-divergence note prefers testing this logic against a fake
// pasteboard source, and GitHub's macos-latest runners have no
// pasteboard session at all (savedpage_seed_test.go's own doc comment),
// so a test that needed a REAL clipboard change to make this trigger
// fire would be CI-hostile by construction.
func TestSeededClipboardHistory_TriggeredRunStoresRedactedEntry(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	s := NewTriggerService(comp, slog.Default(), store)
	comp.SetSyncer(s)

	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := executionsvc.NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	s.SetExecutionService(exec)
	t.Cleanup(func() {
		s.Sync(nil) // stop every listener this test starts
		_ = exec.Shutdown(2 * time.Second)
	})

	history := clipboardhistorysvc.NewClipboardHistoryService(servicetest.NewFakeStore())
	composition.SetClipboardHistoryAppender(history.Append)
	composition.SetSecretRedactor(func(text string) string {
		// No real vault in this test: prove the seam is CALLED (not
		// bypassed) without depending on secretsvc's own real redaction.
		if text == "copy this: known-secret-fake" {
			return "copy this: [redacted]"
		}
		return text
	})
	t.Cleanup(func() {
		composition.SetClipboardHistoryAppender(func(string) error { return nil })
		composition.SetSecretRedactor(func(s string) string { return s })
	})

	var seed composition.Workflow
	for _, wf := range comp.Workflows() {
		if wf.ID == "clipboard-history-workflow" {
			seed = wf
		}
	}
	if seed.ID == "" {
		t.Fatal(`no built-in workflow "clipboard-history-workflow"`)
	}
	if !seed.Disabled {
		t.Fatal(`seeded "Clipboard history" workflow must ship Disabled -- reading the clipboard is opt-in`)
	}
	if seed.PublishedVersion == 0 {
		t.Fatal(`seeded "Clipboard history" workflow must ship PUBLISHED so a single enable arms it`)
	}
	if _, err := comp.SetWorkflowDisabled(seed.ID, false); err != nil {
		t.Fatalf("SetWorkflowDisabled(false): %v", err)
	}
	if !s.ArmedWorkflows()[seed.ID] {
		t.Fatal("the enabled seed is not armed, want ArmedWorkflows() to report it live")
	}

	summary, err := exec.RunWorkflowWithPayload(seed.ID, executionsvc.RunKindTriggered, nil, "copy this: known-secret-fake")
	if err != nil {
		t.Fatalf("RunWorkflowWithPayload: %v", err)
	}
	if summary.Status != "SUCCESS" {
		t.Fatalf("run summary status = %q (pending=%v), want SUCCESS", summary.Status, summary.Pending != nil)
	}

	entries := history.ListClipboardHistory()
	if len(entries) != 1 {
		t.Fatalf("ListClipboardHistory() = %d entries, want exactly 1", len(entries))
	}
	if entries[0].Text != "copy this: [redacted]" {
		t.Errorf("stored entry text = %q, want the REDACTED payload (proves apply-clipboard-history-store called SetSecretRedactor before appending)", entries[0].Text)
	}
}
