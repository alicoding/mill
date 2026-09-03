package composition

import "testing"

const brunoReport = `{"summary":{"totalRequests":2,"passedRequests":1,"failedRequests":1},"results":[
{"name":"ping","path":"ping.bru","suitename":"ping","request":{"method":"GET","url":"http://h/ping"},"response":{"status":200,"duration":12},"status":"pass","error":null},
{"name":"create user","path":"users/create.bru","suitename":"users/create","request":{"method":"POST","url":"http://h/users"},"response":{"status":500,"duration":40},"status":"fail","error":"assertion failed"}]}`

// The seed, driven through its own apply-list-sync node over a report
// shaped like bru's --reporter-json output: every row lands under a
// column the seeded List declares, keyed by the request's path.
func TestSeededBrunoRun_MapsTheReportOntoTheSeededList(t *testing.T) {
	f := swapListSync(t)
	var wf Workflow
	for _, w := range BuiltInWorkflows() {
		if w.ID == ExampleBrunoRunWorkflowID {
			wf = w
		}
	}
	if wf.ID == "" {
		t.Fatal("the seeded Bruno run workflow is missing")
	}
	var sync Node
	for _, n := range wf.Nodes {
		if n.NodeTypeID == "apply-list-sync" {
			sync = n
		}
	}
	if sync.ID == "" {
		t.Fatal("seed shape: no apply-list-sync node")
	}
	if _, err := execApplyListSync(sync, ExecContext{Payload: brunoReport}); err != nil {
		t.Fatal(err)
	}
	if f.listID != "example-bruno-results-list" || len(f.rows) != 2 {
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
		t.Fatal("the seeded Bruno results List is missing")
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
	if f.rows[0]["method"] != "GET" || f.rows[0]["httpStatus"] != "200" || f.rows[1]["status"] != "fail" || f.rows[1]["error"] != "assertion failed" {
		t.Errorf("rows = %v", f.rows)
	}
}
