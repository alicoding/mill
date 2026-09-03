package composition

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/list"
)

// listBuiltInFn keeps the seeded-list read in one place for the proof.
var listBuiltInFn = list.BuiltIn

type fakeSync struct {
	listID, keyColumn string
	rows              []map[string]string
	expire            bool
}

func swapListSync(t *testing.T) *fakeSync {
	t.Helper()
	f := &fakeSync{}
	prev := applyListSyncFn
	applyListSyncFn = func(listID, keyColumn string, rows []map[string]string, expireMissing bool) (ListSyncResult, error) {
		f.listID, f.keyColumn, f.rows, f.expire = listID, keyColumn, rows, expireMissing
		return ListSyncResult{Synced: len(rows), Expired: 1}, nil
	}
	t.Cleanup(func() { applyListSyncFn = prev })
	return f
}

const jiraPayload = `{"total":2,"issues":[
 {"key":"MILL-1","fields":{"summary":"Ship it","status":{"name":"In Progress"},"assignee":{"displayName":"Ali"},"updated":"2026-09-03T01:00:00.000+0000"}},
 {"key":"MILL-2","fields":{"summary":"Write docs","status":{"name":"To Do"},"assignee":null,"updated":"2026-09-02T00:00:00.000+0000"}}]}`

func syncNode(cfg map[string]string) Node {
	base := map[string]string{
		"listId": "example-jira-issues-list", "itemsPath": "issues", "keyColumn": "key", "expireMissing": "true",
		"fieldMap": `{"key":"key","summary":"fields.summary","status":"fields.status.name","assignee":"fields.assignee.displayName","url":"https://jira.example.com/browse/{{key}}"}`,
	}
	for k, v := range cfg {
		base[k] = v
	}
	return Node{ID: "sync", NodeTypeID: "apply-list-sync", Config: base}
}

func TestApplyListSync_MapsEveryItemByPathAndTemplate(t *testing.T) {
	f := swapListSync(t)
	out, err := execApplyListSync(syncNode(nil), ExecContext{Payload: jiraPayload})
	if err != nil {
		t.Fatal(err)
	}
	if f.listID != "example-jira-issues-list" || f.keyColumn != "key" || !f.expire {
		t.Errorf("seam got list %q key %q expire %v", f.listID, f.keyColumn, f.expire)
	}
	if len(f.rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(f.rows))
	}
	first := f.rows[0]
	if first["key"] != "MILL-1" || first["summary"] != "Ship it" || first["status"] != "In Progress" || first["assignee"] != "Ali" {
		t.Errorf("first row = %v", first)
	}
	if first["url"] != "https://jira.example.com/browse/MILL-1" {
		t.Errorf("url template = %q", first["url"])
	}
	if f.rows[1]["assignee"] != "" {
		t.Errorf("a null source field should map to blank, got %q", f.rows[1]["assignee"])
	}
	if out.Attributes["syncedRows"] != 2 || out.Attributes["expiredRows"] != 1 {
		t.Errorf("attributes = %v", out.Attributes)
	}
	if out.Payload != jiraPayload {
		t.Error("payload must pass through unchanged")
	}
}

func TestApplyListSync_FailsLoudlyOnBadInput(t *testing.T) {
	swapListSync(t)
	cases := []struct {
		name    string
		cfg     map[string]string
		payload string
		want    string
	}{
		{"not json", nil, "<html>", "payload is not JSON"},
		{"missing path", map[string]string{"itemsPath": "results"}, jiraPayload, "not found"},
		{"not an array", map[string]string{"itemsPath": "total"}, jiraPayload, "is not an array"},
		{"key column unmapped", map[string]string{"keyColumn": "id"}, jiraPayload, "must name the key column"},
		{"item without key", nil, `{"issues":[{"fields":{"summary":"x"}}]}`, "no value at the key column"},
		{"no list", map[string]string{"listId": ""}, jiraPayload, "listId is required"},
	}
	for _, c := range cases {
		_, err := execApplyListSync(syncNode(c.cfg), ExecContext{Payload: c.payload})
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: error = %v, want %q", c.name, err, c.want)
		}
	}
}

func TestApplyListSync_RootArrayAndIndexedPaths(t *testing.T) {
	f := swapListSync(t)
	node := syncNode(map[string]string{"itemsPath": "", "fieldMap": `{"key":"id","first":"tags.0"}`, "keyColumn": "key"})
	_, err := execApplyListSync(node, ExecContext{Payload: `[{"id":"a","tags":["x","y"]},{"id":"b","tags":[]}]`})
	if err != nil {
		t.Fatal(err)
	}
	if f.rows[0]["first"] != "x" || f.rows[1]["first"] != "" {
		t.Errorf("indexed paths = %v", f.rows)
	}
}

// The seeded example's own config, run against a Jira-shaped result:
// every mapped column exists on the seeded List, every issue lands
// by key, and the url template resolves -- the seed IS the proof.
func TestSeededJiraIssuesSync_MapsTheSearchResultOntoTheSeededList(t *testing.T) {
	f := swapListSync(t)
	var wf Workflow
	for _, w := range BuiltInWorkflows() {
		if w.ID == "example-jira-issues-sync-workflow" {
			wf = w
		}
	}
	if wf.ID == "" {
		t.Fatal("the seeded Jira issues sync workflow is missing")
	}
	var sync Node
	for _, n := range wf.Nodes {
		if n.NodeTypeID == "apply-list-sync" {
			sync = n
		}
	}
	if sync.ID == "" || !wf.Disabled {
		t.Fatalf("seed shape: sync node %q, disabled %v", sync.ID, wf.Disabled)
	}
	if _, err := execApplyListSync(sync, ExecContext{Payload: jiraPayload}); err != nil {
		t.Fatal(err)
	}
	if f.listID != "example-jira-issues-list" || len(f.rows) != 2 {
		t.Fatalf("seam got list %q with %d rows", f.listID, len(f.rows))
	}
	var seeded []string
	for _, l := range listBuiltInFn() {
		if l.ID == f.listID {
			for _, c := range l.Columns {
				seeded = append(seeded, c.Key)
			}
		}
	}
	if len(seeded) == 0 {
		t.Fatal("the seeded Jira issues List is missing")
	}
	for col := range f.rows[0] {
		found := false
		for _, k := range seeded {
			if k == col {
				found = true
			}
		}
		if !found {
			t.Errorf("the seed's field map writes %q, which the seeded List has no column for", col)
		}
	}
	if f.rows[0]["url"] != "https://jira.example.com/browse/MILL-1" || f.rows[1]["status"] != "To Do" {
		t.Errorf("rows = %v", f.rows)
	}
}
