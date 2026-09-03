package configuresvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/seeding"
	"github.com/alicoding/mill/internal/services/servicetest"
)

func newUndoTestService() (*ConfigureService, *servicetest.FakeStore) {
	store := servicetest.NewFakeStore()
	return NewConfigureService(store, compositionsvc.NewCompositionService(store), servicetest.FakeCredentialStore{}), store
}

func TestUndoDelete_RestoresAUserListAtItsIndex(t *testing.T) {
	cfg, _ := newUndoTestService()
	cols := []typedfield.Field{{Key: "name", Label: "Name", Type: typedfield.TypeText}}
	ids := make([]string, 0, 3)
	for _, label := range []string{"Undo A", "Undo B", "Undo C"} {
		l, err := cfg.CreateList(label, "", cols)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, l.ID)
	}
	indexOf := func(id string) int {
		for i, l := range cfg.Lists() {
			if l.ID == id {
				return i
			}
		}
		return -1
	}
	before := indexOf(ids[1])
	if err := cfg.DeleteList(ids[1]); err != nil {
		t.Fatal(err)
	}
	if indexOf(ids[1]) != -1 {
		t.Fatal("deleted list still listed")
	}
	if err := cfg.UndoDelete("list", ids[1]); err != nil {
		t.Fatalf("UndoDelete: %v", err)
	}
	if got := indexOf(ids[1]); got != before {
		t.Fatalf("restored at index %d, want %d", got, before)
	}
	// Persisted: a fresh service over the same store sees it.
	cfg2 := NewConfigureService(cfg.store, compositionsvc.NewCompositionService(cfg.store), servicetest.FakeCredentialStore{})
	found := false
	for _, l := range cfg2.Lists() {
		found = found || l.ID == ids[1]
	}
	if !found {
		t.Fatal("restored list not persisted")
	}
	if err := cfg.UndoDelete("list", ids[1]); err == nil || !strings.Contains(err.Error(), "nothing to undo") {
		t.Fatalf("second undo: %v", err)
	}
}

func TestUndoDelete_ClearsABuiltInRequestsTombstone_AndLeavesItsSecretPurged(t *testing.T) {
	cfg, store := newUndoTestService()
	// The first seeded request a workflow does not reference: the
	// reference-integrity refusal stays in front of the undo door.
	id := ""
	for _, r := range cfg.HTTPRequests() {
		if !r.BuiltIn {
			continue
		}
		if err := cfg.DeleteHTTPRequest(r.ID); err == nil {
			id = r.ID
			break
		} else if !strings.Contains(err.Error(), "still referenced") {
			t.Fatal(err)
		}
	}
	if id == "" {
		t.Fatal("no deletable built-in request seeded")
	}
	if !seeding.LoadTombstones(store)[id] {
		t.Fatal("built-in delete recorded no tombstone")
	}
	if err := cfg.UndoDelete("request", id); err != nil {
		t.Fatalf("UndoDelete: %v", err)
	}
	if seeding.LoadTombstones(store)[id] {
		t.Fatal("undo left the seed tombstone in place")
	}
	restored := false
	for _, r := range cfg.HTTPRequests() {
		restored = restored || r.ID == id
	}
	if !restored {
		t.Fatal("request not restored")
	}
	// Credential material the delete purged stays purged: the restorer
	// reinserts the record only (configureservice_undodelete.go), so
	// the restored request reads as having no secret.
	if err := cfg.UndoDelete("request", "no-such"); err == nil {
		t.Fatal("unknown id must fail")
	}
}
