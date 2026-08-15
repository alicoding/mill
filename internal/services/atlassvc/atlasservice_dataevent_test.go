package atlassvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// captureEmits mirrors compositionsvc's/configuresvc's/guardrailsvc's
// own helper of the same name (see guardrailservice_dataevent_test.go
// for the full seam reasoning).
func captureEmits(t *testing.T) *[]dataevent.Changed {
	t.Helper()
	var got []dataevent.Changed
	dataevent.TestHook = func(entity, id string) {
		got = append(got, dataevent.Changed{Entity: entity, ID: id})
	}
	t.Cleanup(func() { dataevent.TestHook = nil })
	return &got
}

// assertEmitted checks got contains an ("atlas", id) pair -- every
// Atlas mutator emits the same "atlas" entity string (dataevent.go's
// own doc comment), so unlike guardrailsvc's own helper of this name
// there is no second entity value any caller here would ever pass.
func assertEmitted(t *testing.T, got []dataevent.Changed, id string) {
	t.Helper()
	for _, c := range got {
		if c.Entity == "atlas" && c.ID == id {
			return
		}
	}
	t.Errorf("dataevent.Emit(%q, %q) was not observed; got %+v", "atlas", id, got)
}

// TestDataEvent_EveryMutatorEmits proves goal 0017's P0-3 for Atlas:
// every successful CRUD/Move/SetPosition/SetViewMode/SetLens mutation
// fires the "atlas" entity on mill-data-changed, so another open Atlas
// tab/space refreshes when something changes elsewhere.
func TestDataEvent_EveryMutatorEmits(t *testing.T) {
	a := newTestAtlasService(t)

	got := captureEmits(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	assertEmitted(t, *got, k.ID)

	got = captureEmits(t)
	k, err = a.UpdateKind(k.ID, "Widget v2", "", "", nil)
	if err != nil {
		t.Fatalf("UpdateKind: %v", err)
	}
	assertEmitted(t, *got, k.ID)

	got = captureEmits(t)
	lk, err := a.CreateLinkKind("connects to", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}
	assertEmitted(t, *got, lk.ID)

	got = captureEmits(t)
	lk, err = a.UpdateLinkKind(lk.ID, "connects to v2", "")
	if err != nil {
		t.Fatalf("UpdateLinkKind: %v", err)
	}
	assertEmitted(t, *got, lk.ID)

	got = captureEmits(t)
	c1, err := a.CreateCard(k.ID, "A", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	assertEmitted(t, *got, c1.ID)

	got = captureEmits(t)
	c2, err := a.CreateCard(k.ID, "B", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	assertEmitted(t, *got, c2.ID)

	got = captureEmits(t)
	c1, err = a.UpdateCard(c1.ID, "A v2", "", nil, "", "", "")
	if err != nil {
		t.Fatalf("UpdateCard: %v", err)
	}
	assertEmitted(t, *got, c1.ID)

	got = captureEmits(t)
	if _, err := a.MoveCard(c1.ID, c2.ID); err != nil {
		t.Fatalf("MoveCard: %v", err)
	}
	assertEmitted(t, *got, c1.ID)

	got = captureEmits(t)
	if _, err := a.SetPosition(c1.ID, &atlas.Position{X: 1, Y: 2}); err != nil {
		t.Fatalf("SetPosition: %v", err)
	}
	assertEmitted(t, *got, c1.ID)

	got = captureEmits(t)
	if _, err := a.SetViewMode(c2.ID, atlas.ViewModeCanvas); err != nil {
		t.Fatalf("SetViewMode: %v", err)
	}
	assertEmitted(t, *got, c2.ID)

	got = captureEmits(t)
	link, err := a.CreateLink(c1.ID, c2.ID, lk.ID, "")
	if err != nil {
		t.Fatalf("CreateLink: %v", err)
	}
	assertEmitted(t, *got, link.ID)

	got = captureEmits(t)
	link, err = a.UpdateLink(link.ID, "v2")
	if err != nil {
		t.Fatalf("UpdateLink: %v", err)
	}
	assertEmitted(t, *got, link.ID)

	got = captureEmits(t)
	if err := a.SetLens(c2.ID, []string{k.ID}, false); err != nil {
		t.Fatalf("SetLens: %v", err)
	}
	assertEmitted(t, *got, c2.ID)

	got = captureEmits(t)
	if err := a.DeleteLink(link.ID); err != nil {
		t.Fatalf("DeleteLink: %v", err)
	}
	assertEmitted(t, *got, link.ID)

	got = captureEmits(t)
	// c1 was moved under c2 above, so delete it first (children-block
	// deletion) before c2 can be deleted.
	if err := a.DeleteCard(c1.ID); err != nil {
		t.Fatalf("DeleteCard: %v", err)
	}
	assertEmitted(t, *got, c1.ID)

	got = captureEmits(t)
	if err := a.DeleteCard(c2.ID); err != nil {
		t.Fatalf("DeleteCard: %v", err)
	}
	assertEmitted(t, *got, c2.ID)

	got = captureEmits(t)
	if err := a.DeleteLinkKind(lk.ID); err != nil {
		t.Fatalf("DeleteLinkKind: %v", err)
	}
	assertEmitted(t, *got, lk.ID)

	got = captureEmits(t)
	if err := a.DeleteKind(k.ID); err != nil {
		t.Fatalf("DeleteKind: %v", err)
	}
	assertEmitted(t, *got, k.ID)
}
