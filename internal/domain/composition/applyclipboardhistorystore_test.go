package composition

import (
	"errors"
	"strings"
	"testing"
)

// TestExecuteWorkflow_ClipboardHistoryStore_RedactsBeforeAppending
// proves the store node runs the payload through redactSecretsFn (goal
// 0234's "a secret is never persisted in history, full stop"
// requirement) BEFORE calling the injected appender, and that the
// redacted text -- not the raw one -- is what gets forwarded as the
// node's own result.
func TestExecuteWorkflow_ClipboardHistoryStore_RedactsBeforeAppending(t *testing.T) {
	origRedact, origAppend := redactSecretsFn, appendClipboardHistoryFn
	t.Cleanup(func() { redactSecretsFn, appendClipboardHistoryFn = origRedact, origAppend })

	SetSecretRedactor(func(s string) string { return strings.ReplaceAll(s, "super-secret-fake", "[redacted]") })
	var appended string
	SetClipboardHistoryAppender(func(text string) error {
		appended = text
		return nil
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "apply-clipboard-history-store",
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	result, err := ExecuteWorkflow(nodes, nil, nil, ExecuteOptions{InitialPayload: "copied: super-secret-fake"})
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}

	if strings.Contains(appended, "super-secret-fake") {
		t.Fatalf("appended text leaked the raw secret: %q", appended)
	}
	if !strings.Contains(appended, "[redacted]") {
		t.Fatalf("appended = %q, want the redaction placeholder", appended)
	}
	if result != appended {
		t.Errorf("ExecuteWorkflow result = %q, want it to match the redacted text actually stored (%q)", result, appended)
	}
}

// TestExecuteWorkflow_ClipboardHistoryStore_AppendErrorPropagates
// proves a storage failure (e.g. persisting to settings.Store) surfaces
// as the node's own error, prefixed per node-standard.md's
// error-prefix convention, rather than being swallowed.
func TestExecuteWorkflow_ClipboardHistoryStore_AppendErrorPropagates(t *testing.T) {
	origAppend := appendClipboardHistoryFn
	t.Cleanup(func() { appendClipboardHistoryFn = origAppend })

	SetClipboardHistoryAppender(func(string) error { return errors.New("disk full") })

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "apply-clipboard-history-store",
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	_, err = ExecuteWorkflow(nodes, nil, nil, ExecuteOptions{InitialPayload: "some text"})
	if err == nil {
		t.Fatal("ExecuteWorkflow() error = nil, want the append failure to propagate")
	}
	if !strings.Contains(err.Error(), "apply-clipboard-history-store: disk full") {
		t.Errorf("error = %q, want it to carry the node type id prefix", err.Error())
	}
}
