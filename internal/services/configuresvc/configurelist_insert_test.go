package configuresvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// The boundary-insert affordance (goal 0105 part 2): a row lands
// exactly at the pointed index; out-of-range appends (AddListRow's
// own path).
func TestAddListRowAt_InsertsAtIndex(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := NewConfigureService(store, comp, servicetest.FakeCredentialStore{})

	l, err := cfg.CreateList("Insert test", "", []typedfield.Field{{Key: "name", Label: "Name", Type: typedfield.TypeText}})
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}
	for _, v := range []string{"first", "last"} {
		if _, err := cfg.AddListRow(l.ID, map[string]string{"name": v}); err != nil {
			t.Fatalf("AddListRow(%s): %v", v, err)
		}
	}

	got, err := cfg.AddListRowAt(l.ID, map[string]string{"name": "middle"}, 1)
	if err != nil {
		t.Fatalf("AddListRowAt: %v", err)
	}
	order := make([]string, 0, len(got.Rows))
	for _, r := range got.Rows {
		order = append(order, r.Values["name"])
	}
	if len(order) != 3 || order[0] != "first" || order[1] != "middle" || order[2] != "last" {
		t.Errorf("row order = %v, want [first middle last]", order)
	}

	if got, err = cfg.AddListRowAt(l.ID, map[string]string{"name": "tail"}, 99); err != nil {
		t.Fatalf("AddListRowAt(out of range): %v", err)
	}
	if got.Rows[len(got.Rows)-1].Values["name"] != "tail" {
		t.Errorf("out-of-range index must append; got %v", got.Rows)
	}
}
