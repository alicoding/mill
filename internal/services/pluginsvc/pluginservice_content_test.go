package pluginsvc

import (
	"strings"
	"testing"
)

// Refusals that need no rule happen before the guardrail (nil here)
// and before the writer (nil here): a nil-deref would fail the test.
func TestWriteContentForPlugin_RefusesBeforeRules(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "reader", `{"id":"reader","name":"R","version":"1"}`, nil)
	writePlugin(t, root, "writer", `{"id":"writer","name":"W","version":"1","capabilities":["write-content"]}`, nil)
	svc := New(root, nil, "1.0.0")
	cases := []struct {
		plugin string
		req    PluginContentWrite
		want   string
	}{
		{"reader", PluginContentWrite{Op: "note", Text: "hi"}, "write-content"},
		{"writer", PluginContentWrite{Op: "sticker"}, "unknown content write op"},
		{"writer", PluginContentWrite{Op: "note", Text: "  "}, "needs text"},
		{"writer", PluginContentWrite{Op: "card", Title: "T"}, "kindId and a title"},
		{"writer", PluginContentWrite{Op: "card-update"}, "needs a cardId"},
		{"writer", PluginContentWrite{Op: "list-row"}, "needs a listId"},
		// Well-formed but unwired: refused rather than performed unguarded.
		{"writer", PluginContentWrite{Op: "note", Text: "Plan"}, "unavailable"},
	}
	for _, c := range cases {
		_, err := svc.WriteContentForPlugin(c.plugin, c.req)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s %+v: error = %v, want %q", c.plugin, c.req, err, c.want)
		}
	}
}

func TestDescribeContentWrite_NamesTheTargetForReview(t *testing.T) {
	attrs, desc, err := describeContentWrite(PluginContentWrite{Op: "note", Text: "# Weekly plan\nbody", ParentID: "p1"})
	if err != nil || desc != "Create a note: Weekly plan" || attrs["parentId"] != "p1" || attrs["op"] != "note" {
		t.Errorf("note: %v %q %v", err, desc, attrs)
	}
	attrs, desc, err = describeContentWrite(PluginContentWrite{Op: "card", Title: "Acme", KindID: "kind-vendor"})
	if err != nil || desc != "Create a card: Acme" || attrs["kindId"] != "kind-vendor" {
		t.Errorf("card: %v %q %v", err, desc, attrs)
	}
	_, desc, err = describeContentWrite(PluginContentWrite{Op: "list-row", ListID: "list-1", Values: map[string]string{"a": "b"}})
	if err != nil || !strings.Contains(desc, "list-1") {
		t.Errorf("list-row: %v %q", err, desc)
	}
}
