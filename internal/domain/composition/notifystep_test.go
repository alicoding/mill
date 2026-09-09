package composition

import (
	"fmt"
	"reflect"
	"strconv"
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
			"title": "Webhook event", "titleAttribute": "title",
			"body": "A tool posted a webhook event.", "bodyAttribute": "body",
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
		node := Node{Config: map[string]string{"title": "Webhook event", "titleAttribute": "missing"}}
		if _, err := execNotify(node, ExecContext{}); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if gotTitle != "Webhook event" {
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

	t.Run("{{attribute}} in title/body resolves against the step's Attributes", func(t *testing.T) {
		restore := notifierFn
		defer func() { notifierFn = restore }()
		var gotTitle, gotBody string
		notifierFn = func(title, body, _ string, _ []string) error { gotTitle, gotBody = title, body; return nil }
		node := Node{Config: map[string]string{
			"title": "{{label}} changed", "body": "List {{entityId}} is now unused.",
		}}
		ctx, err := execNotify(node, ExecContext{Attributes: map[string]any{"label": "Groceries", "entityId": "list-42"}})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if gotTitle != "Groceries changed" || gotBody != "List list-42 is now unused." {
			t.Errorf("notifier received (%q, %q)", gotTitle, gotBody)
		}
		if _, ok := ctx.Attributes["notifyNote"]; ok {
			t.Errorf("notifyNote = %v, want none when every reference resolved", ctx.Attributes["notifyNote"])
		}
	})

	t.Run("an unresolved {{attribute}} sends empty text and leaves a run-detail note", func(t *testing.T) {
		restore := notifierFn
		defer func() { notifierFn = restore }()
		var gotBody string
		notifierFn = func(_, body, _ string, _ []string) error { gotBody = body; return nil }
		node := Node{Config: map[string]string{"title": "Done", "body": "List {{missingAttr}} is unused."}}
		ctx, err := execNotify(node, ExecContext{})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if gotBody != "List  is unused." {
			t.Errorf("body = %q, want the reference rendered empty", gotBody)
		}
		if note, _ := ctx.Attributes["notifyNote"].(string); note != "{{missingAttr}} had no value" {
			t.Errorf("notifyNote = %q, want the missing-value note", note)
		}
	})

	t.Run("titleAttribute's swapped-in value can itself carry {{attribute}} references", func(t *testing.T) {
		restore := notifierFn
		defer func() { notifierFn = restore }()
		var gotTitle string
		notifierFn = func(title, _, _ string, _ []string) error { gotTitle = title; return nil }
		node := Node{Config: map[string]string{"title": "fallback", "titleAttribute": "headline"}}
		if _, err := execNotify(node, ExecContext{Attributes: map[string]any{"headline": "{{count}} rows", "count": "3"}}); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if gotTitle != "3 rows" {
			t.Errorf("title = %q, want the attribute's own {{count}} reference resolved", gotTitle)
		}
	})

	t.Run("a title that is only an unresolved reference is empty and required", func(t *testing.T) {
		node := Node{Config: map[string]string{"title": "{{missing}}"}}
		if _, err := execNotify(node, ExecContext{}); err == nil || !strings.Contains(err.Error(), "title is required") {
			t.Fatalf("expected the title-required error, got %v", err)
		}
	})
}

func TestInterpolateNotifyText(t *testing.T) {
	vars := map[string]string{"entityId": "list-42", "label": "Groceries"}
	cases := []struct {
		name, in, want string
		missing        []string
	}{
		{name: "present reference resolves", in: "List {{entityId}} is unused", want: "List list-42 is unused"},
		{name: "missing reference renders empty, not the literal token", in: "Hi {{nope}}", want: "Hi ", missing: []string{"nope"}},
		{name: "two tokens both resolve", in: "{{label}} ({{entityId}})", want: "Groceries (list-42)"},
		{name: "escaped braces stay literal", in: `\{{entityId}}`, want: "{{entityId}}"},
		{name: "braces outside a token are untouched", in: `{"a":{"b":1}}`, want: `{"a":{"b":1}}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, missing, err := interpolateNotifyText(tc.in, vars)
			if err != nil {
				t.Fatalf("interpolateNotifyText(%q) unexpected error: %v", tc.in, err)
			}
			if got != tc.want {
				t.Errorf("interpolateNotifyText(%q) = %q, want %q", tc.in, got, tc.want)
			}
			if len(missing) != len(tc.missing) || (len(missing) > 0 && !reflect.DeepEqual(missing, tc.missing)) {
				t.Errorf("interpolateNotifyText(%q) missing = %v, want %v", tc.in, missing, tc.missing)
			}
		})
	}
}

// TestInterpolateNotifyText_CapsRunaway pins the go/allocation-size-
// overflow guard (CWE-190): a run whose combined attribute and
// missing-reference count exceeds maxMergedMapEntries is rejected
// with a typed error instead of feeding an unbounded sum into the
// blanked map's capacity hint, while a normal-sized run still renders.
func TestInterpolateNotifyText_CapsRunaway(t *testing.T) {
	t.Run("a normal-sized run renders", func(t *testing.T) {
		vars := map[string]string{"entityId": "list-42"}
		got, missing, err := interpolateNotifyText("List {{entityId}} / {{nope}}", vars)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != "List list-42 / " {
			t.Errorf("got = %q", got)
		}
		if !reflect.DeepEqual(missing, []string{"nope"}) {
			t.Errorf("missing = %v", missing)
		}
	})

	t.Run("an oversized attribute bag is rejected, not overflowed into", func(t *testing.T) {
		vars := make(map[string]string, maxMergedMapEntries+1)
		for i := 0; i <= maxMergedMapEntries; i++ {
			vars[strconv.Itoa(i)] = "x"
		}
		_, _, err := interpolateNotifyText("{{nope}}", vars)
		if err == nil || !strings.Contains(err.Error(), "too many entries to merge") {
			t.Fatalf("expected the too-many-entries error, got %v", err)
		}
	})
}
