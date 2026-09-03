package configuresvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/list"
)

// The synced-List writer (docs/goals/0299): a batch upserts by key,
// a second batch updates in place, and the missing key is marked
// expired -- never deleted, and never re-expired on a later batch.
func TestSyncListRows_UpsertsByKeyAndExpiresTheMissing(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	l, err := cfg.CreateList("Issues", "", trackerColumns())
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}
	first, err := cfg.SyncListRows(l.ID, "task", []map[string]string{
		{"task": "MILL-1", "count": "1"},
		{"task": "MILL-2", "count": "2"},
	}, true)
	if err != nil {
		t.Fatal(err)
	}
	if first.Synced != 2 || first.Expired != 0 {
		t.Errorf("first sync = %+v, want 2 synced, 0 expired", first)
	}
	second, err := cfg.SyncListRows(l.ID, "task", []map[string]string{{"task": "MILL-1", "count": "3"}}, true)
	if err != nil {
		t.Fatal(err)
	}
	if second.Synced != 1 || second.Expired != 1 {
		t.Errorf("second sync = %+v, want 1 synced, 1 expired", second)
	}
	got, err := cfg.GetList(l.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Rows) != 2 {
		t.Fatalf("rows = %d, want 2 (expired rows are kept)", len(got.Rows))
	}
	byKey := map[string]list.Row{}
	for _, r := range got.Rows {
		byKey[r.Values["task"]] = r
	}
	if byKey["MILL-1"].Values["count"] != "3" || byKey["MILL-1"].Status != list.RowActive {
		t.Errorf("MILL-1 = %+v, want count 3, active", byKey["MILL-1"])
	}
	if byKey["MILL-2"].Status != list.RowExpired {
		t.Errorf("MILL-2 status = %q, want expired", byKey["MILL-2"].Status)
	}
	third, err := cfg.SyncListRows(l.ID, "task", []map[string]string{{"task": "MILL-1", "count": "3"}}, true)
	if err != nil {
		t.Fatal(err)
	}
	if third.Expired != 0 {
		t.Errorf("an already-expired row was expired again: %+v", third)
	}
	off, err := cfg.SyncListRows(l.ID, "task", []map[string]string{{"task": "MILL-3", "count": "1"}}, false)
	if err != nil {
		t.Fatal(err)
	}
	if off.Expired != 0 || off.Synced != 1 {
		t.Errorf("expireMissing off = %+v, want 1 synced, 0 expired", off)
	}
}
