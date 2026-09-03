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
		{"writer", PluginContentWrite{Op: "list", Columns: []PluginListColumn{{Name: "A"}}}, "needs a title"},
		{"writer", PluginContentWrite{Op: "list", Title: "T"}, "at least one column"},
		{"writer", PluginContentWrite{Op: "list", Title: "T", Columns: []PluginListColumn{{Name: " "}}}, "needs a name"},
		{"writer", PluginContentWrite{Op: "list", Title: "T", Columns: []PluginListColumn{{Name: "A", Type: "emoji"}}}, "column type"},
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
	attrs, desc, err = describeContentWrite(PluginContentWrite{Op: "list", Title: "Vendors", Columns: []PluginListColumn{{Name: "Vendor"}, {Name: "Tier", Type: "text"}}, Rows: []map[string]string{{"Vendor": "Acme"}}})
	if err != nil || desc != "Create a list: Vendors (2 columns, 1 rows)" || attrs["title"] != "Vendors" {
		t.Errorf("list: %v %q %v", err, desc, attrs)
	}
}

func TestListColumns_UniqueSlugKeysAndNameKeyedRows(t *testing.T) {
	fields, rows := listColumns(
		[]PluginListColumn{{Name: "Vendor Name"}, {Name: "vendor name", Type: "number"}, {Name: "!!"}},
		[]map[string]string{{"Vendor Name": "Acme", "vendor name": "3", "other": "x"}},
	)
	if len(fields) != 3 || fields[0].Key != "vendor-name" || fields[1].Key != "vendor-name-2" || fields[2].Key != "column" {
		t.Fatalf("fields = %+v", fields)
	}
	if fields[1].Type != "number" || fields[0].Type != "text" || fields[0].Label != "Vendor Name" {
		t.Fatalf("types/labels = %+v", fields)
	}
	if rows[0]["vendor-name"] != "Acme" || rows[0]["vendor-name-2"] != "3" || rows[0]["other"] != "x" {
		t.Fatalf("rows = %+v", rows)
	}
}
