package composition

import (
	"fmt"
	"strings"
	"testing"
)

func TestExecNotify(t *testing.T) {
	t.Run("notifies via the injected function with the configured title and body", func(t *testing.T) {
		restore := notifierFn
		defer func() { notifierFn = restore }()
		var gotTitle, gotBody string
		notifierFn = func(title, body string) error { gotTitle, gotBody = title, body; return nil }
		node := Node{Config: map[string]string{"title": "Done", "body": "Ready to paste."}}
		if _, err := execNotify(node, ExecContext{}); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if gotTitle != "Done" || gotBody != "Ready to paste." {
			t.Errorf("notifier received (%q, %q)", gotTitle, gotBody)
		}
	})

	t.Run("bodyAttribute swaps the fixed message when the attribute is set", func(t *testing.T) {
		restore := notifierFn
		defer func() { notifierFn = restore }()
		var gotBody string
		notifierFn = func(_, body string) error { gotBody = body; return nil }
		node := Node{Config: map[string]string{"title": "Done", "body": "fallback", "bodyAttribute": "summary"}}
		if _, err := execNotify(node, ExecContext{Attributes: map[string]any{"summary": "3 rows written"}}); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if gotBody != "3 rows written" {
			t.Errorf("body = %q, want the attribute value", gotBody)
		}
	})

	t.Run("missing title is a named error", func(t *testing.T) {
		if _, err := execNotify(Node{Config: map[string]string{}}, ExecContext{}); err == nil || !strings.Contains(err.Error(), "title is required") {
			t.Fatalf("expected the title-required error, got %v", err)
		}
	})

	t.Run("notifier failure propagates with the node prefix", func(t *testing.T) {
		restore := notifierFn
		defer func() { notifierFn = restore }()
		notifierFn = func(_, _ string) error { return fmt.Errorf("no permission") }
		_, err := execNotify(Node{Config: map[string]string{"title": "Done"}}, ExecContext{})
		if err == nil || !strings.Contains(err.Error(), "apply-notify:") {
			t.Fatalf("expected a prefixed error, got %v", err)
		}
	})
}
