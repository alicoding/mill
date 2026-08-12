package guardrailsvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// captureEmits mirrors compositionsvc's/configuresvc's own helper of
// the same name (see compositionsvc/compositionservice_dataevent_test.go
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

func assertEmitted(t *testing.T, got []dataevent.Changed, entity, id string) {
	t.Helper()
	for _, c := range got {
		if c.Entity == entity && c.ID == id {
			return
		}
	}
	t.Errorf("dataevent.Emit(%q, %q) was not observed; got %+v", entity, id, got)
}

// TestDataEvent_RuleMutations proves goal 0017's P0-3: guardrail rule
// CRUD emits a NEW "guardrail-rule" entity on mill-data-changed, so a
// canvas open in another tab re-runs its verdict badges when a rule
// changes elsewhere.
func TestDataEvent_RuleMutations(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	g := NewGuardrailService(store, comp)

	got := captureEmits(t)
	rule, err := g.CreateRule(guardrail.Rule{Label: "Emit test rule", Effect: guardrail.EffectAllow, NodeTypeID: "list-lookup"})
	if err != nil {
		t.Fatalf("CreateRule: %v", err)
	}
	assertEmitted(t, *got, "guardrail-rule", rule.ID)

	got = captureEmits(t)
	rule.Label = "Emit test rule (edited)"
	if err := g.UpdateRule(rule); err != nil {
		t.Fatalf("UpdateRule: %v", err)
	}
	assertEmitted(t, *got, "guardrail-rule", rule.ID)

	got = captureEmits(t)
	if err := g.DeleteRule(rule.ID); err != nil {
		t.Fatalf("DeleteRule: %v", err)
	}
	assertEmitted(t, *got, "guardrail-rule", rule.ID)
}
