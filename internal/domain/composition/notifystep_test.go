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
		notifierFn = func(title, body, _ string, _ []string) error { gotTitle, gotBody = title, body; return nil }
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
		notifierFn = func(_, body, _ string, _ []string) error { gotBody = body; return nil }
		node := Node{Config: map[string]string{"title": "Done", "body": "fallback", "bodyAttribute": "summary"}}
		if _, err := execNotify(node, ExecContext{Attributes: map[string]any{"summary": "3 rows written"}}); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if gotBody != "3 rows written" {
			t.Errorf("body = %q, want the attribute value", gotBody)
		}
	})

	t.Run("titleAttribute swaps the fixed title when the attribute is set", func(t *testing.T) {
		restore := notifierFn
		defer func() { notifierFn = restore }()
		var gotTitle, gotBody string
		notifierFn = func(title, body, _ string, _ []string) error { gotTitle, gotBody = title, body; return nil }
		node := Node{Config: map[string]string{
			"title": "Agent event", "titleAttribute": "title",
			"body": "An agent tool fired a hook event.", "bodyAttribute": "body",
		}}
		if _, err := execNotify(node, ExecContext{Attributes: map[string]any{"title": "Build finished", "body": "make test passed"}}); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if gotTitle != "Build finished" || gotBody != "make test passed" {
			t.Errorf("notifier received (%q, %q), want both attribute values", gotTitle, gotBody)
		}
	})

	t.Run("titleAttribute keeps the fixed title when the attribute is absent", func(t *testing.T) {
		restore := notifierFn
		defer func() { notifierFn = restore }()
		var gotTitle string
		notifierFn = func(title, _, _ string, _ []string) error { gotTitle = title; return nil }
		node := Node{Config: map[string]string{"title": "Agent event", "titleAttribute": "missing"}}
		if _, err := execNotify(node, ExecContext{}); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if gotTitle != "Agent event" {
			t.Errorf("title = %q, want the fixed fallback", gotTitle)
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
		notifierFn = func(_, _, _ string, _ []string) error { return fmt.Errorf("no permission") }
		_, err := execNotify(Node{Config: map[string]string{"title": "Done"}}, ExecContext{})
		if err == nil || !strings.Contains(err.Error(), "apply-notify:") {
			t.Fatalf("expected a prefixed error, got %v", err)
		}
	})

	t.Run("targets parses the configured JSON array of device ids", func(t *testing.T) {
		restore := notifierFn
		defer func() { notifierFn = restore }()
		var gotTargets []string
		notifierFn = func(_, _, _ string, targets []string) error { gotTargets = targets; return nil }
		node := Node{Config: map[string]string{"title": "Done", "targets": `["dev-1","dev-2"]`}}
		if _, err := execNotify(node, ExecContext{}); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(gotTargets) != 2 || gotTargets[0] != "dev-1" || gotTargets[1] != "dev-2" {
			t.Errorf("targets = %v, want [dev-1 dev-2]", gotTargets)
		}
	})

	t.Run("empty targets reaches every device (nil, not an empty-string error)", func(t *testing.T) {
		restore := notifierFn
		defer func() { notifierFn = restore }()
		var gotTargets []string
		called := false
		notifierFn = func(_, _, _ string, targets []string) error { gotTargets = targets; called = true; return nil }
		node := Node{Config: map[string]string{"title": "Done"}}
		if _, err := execNotify(node, ExecContext{}); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !called || gotTargets != nil {
			t.Errorf("targets = %v, want nil (broadcast to every device)", gotTargets)
		}
	})

	t.Run("malformed targets is a named error", func(t *testing.T) {
		node := Node{Config: map[string]string{"title": "Done", "targets": "not-json"}}
		if _, err := execNotify(node, ExecContext{}); err == nil || !strings.Contains(err.Error(), "targets") {
			t.Fatalf("expected a targets-named error, got %v", err)
		}
	})
}
