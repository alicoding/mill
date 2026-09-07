package pluginsvc

import (
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// fakeFieldWriter is the ContentWriter seam reduced to the one door
// card-field edits use -- every other write errors if reached, so a
// test notices a door the flow was never meant to touch.
type fakeFieldWriter struct {
	writes []map[string]string
	err    error
}

func (f *fakeFieldWriter) CreateNote(text, parentID string, pos *atlas.Position) (atlas.Note, error) {
	return atlas.Note{}, errUnexpectedDoor
}

func (f *fakeFieldWriter) CreateCard(kindID, title, note string, fields map[string]string, parentID string) (atlas.Card, error) {
	return atlas.Card{}, errUnexpectedDoor
}

func (f *fakeFieldWriter) UpdateCard(id, title, note string, fields map[string]string) (atlas.Card, error) {
	return atlas.Card{}, errUnexpectedDoor
}

func (f *fakeFieldWriter) SetCardFields(cardID string, fields map[string]string) error {
	f.writes = append(f.writes, fields)
	return f.err
}

func (f *fakeFieldWriter) AppendListRow(listID string, values map[string]string) error {
	return errUnexpectedDoor
}

func (f *fakeFieldWriter) CreateList(label, description string, columns []typedfield.Field, rows []map[string]string) (string, error) {
	return "", errUnexpectedDoor
}

var errUnexpectedDoor = errFakeDoor{}

type errFakeDoor struct{}

func (errFakeDoor) Error() string { return "a door this flow never touches was reached" }

func newCardFieldsHarness(t *testing.T) (*PluginService, *guardrailsvc.GuardrailService, *fakeFieldWriter) {
	t.Helper()
	root := t.TempDir()
	writePlugin(t, root, "roadmapper", `{"id":"roadmapper","name":"Roadmapper","version":"1","capabilities":["edit-card-fields"]}`, nil)
	writePlugin(t, root, "plain", `{"id":"plain","name":"Plain","version":"1"}`, nil)
	store := servicetest.NewFakeStore()
	guard := guardrailsvc.NewGuardrailService(store, compositionsvc.NewCompositionService(store))
	svc := New(root, guard, "1.0.0")
	writer := &fakeFieldWriter{}
	svc.WireContentWrites(writer)
	return svc, guard, writer
}

// Refusals needing no rule happen before the guardrail: undeclared
// capability, malformed asks. An approved write reaches exactly the
// field door, carrying the same keys.
func TestSetCardFieldsForPlugin_GuardsThenWrites(t *testing.T) {
	svc, guard, writer := newCardFieldsHarness(t)

	if _, err := svc.SetCardFieldsForPlugin("plain", "card-1", map[string]string{"horizon": "Now"}); err == nil || !strings.Contains(err.Error(), "edit-card-fields") {
		t.Errorf("undeclared capability must refuse naming it: %v", err)
	}
	if _, err := svc.SetCardFieldsForPlugin("roadmapper", " ", map[string]string{"horizon": "Now"}); err == nil || !strings.Contains(err.Error(), "cardId") {
		t.Errorf("empty cardId must refuse: %v", err)
	}
	if _, err := svc.SetCardFieldsForPlugin("roadmapper", "card-1", nil); err == nil || !strings.Contains(err.Error(), "at least one field") {
		t.Errorf("empty fields must refuse: %v", err)
	}
	if len(writer.writes) != 0 {
		t.Fatalf("a refused ask still wrote: %v", writer.writes)
	}

	if _, err := guard.CreateRule(guardrail.Rule{Label: "Allow field edits", Effect: guardrail.EffectAllow, NodeTypeID: CardFieldsKind}); err != nil {
		t.Fatal(err)
	}
	out, err := svc.SetCardFieldsForPlugin("roadmapper", "card-1", map[string]string{"horizon": "Next"})
	if err != nil || !out.Approved || out.ID != "card-1" {
		t.Fatalf("approved write: %+v %v", out, err)
	}
	if len(writer.writes) != 1 || writer.writes[0]["horizon"] != "Next" {
		t.Errorf("the field door saw %v, want exactly the written map", writer.writes)
	}
}

// A deny rule reaches the result, the write never does (goal 0357's
// guarded-deny path): the field door stays untouched and the result
// names what decided.
func TestSetCardFieldsForPlugin_DenyRuleStopsTheWrite(t *testing.T) {
	svc, guard, writer := newCardFieldsHarness(t)
	if _, err := guard.CreateRule(guardrail.Rule{Label: "No field edits", Effect: guardrail.EffectDeny, NodeTypeID: CardFieldsKind}); err != nil {
		t.Fatal(err)
	}
	out, err := svc.SetCardFieldsForPlugin("roadmapper", "card-1", map[string]string{"horizon": "Now"})
	if err != nil {
		t.Fatal(err)
	}
	if out.Approved || out.RuleLabel != "No field edits" || string(out.Effect) != "deny" {
		t.Errorf("deny result = %+v", out)
	}
	if len(writer.writes) != 0 {
		t.Errorf("a denied ask still wrote: %v", writer.writes)
	}
}

// docs/goals/0357 S1b: a bundled plugin's card-field write is approved
// by the seeded rule with no ask, and the write still lands through
// the exact same door an ask-then-approve write does -- an
// allow-by-rule decision changes nothing about what gets audited.
func TestSetCardFieldsForPlugin_BuiltInPluginAllowedBySeededRule(t *testing.T) {
	root := t.TempDir()
	store := servicetest.NewFakeStore()
	guard := guardrailsvc.NewGuardrailService(store, compositionsvc.NewCompositionService(store))
	svc := New(root, guard, "1.0.0")
	writer := &fakeFieldWriter{}
	svc.WireContentWrites(writer)

	out, err := svc.SetCardFieldsForPlugin("mill-roadmap", "card-1", map[string]string{"horizon": "Now"})
	if err != nil {
		t.Fatalf("SetCardFieldsForPlugin(mill-roadmap): %v", err)
	}
	if !out.Approved || out.Effect != string(guardrail.EffectAllow) || out.RuleLabel != "Allow bundled extensions to edit card fields" {
		t.Errorf("built-in plugin write = %+v, want an immediate allow naming the seeded rule", out)
	}
	if len(writer.writes) != 1 || writer.writes[0]["horizon"] != "Now" {
		t.Errorf("the field door saw %v, want exactly the written map -- an allow-by-rule write is audited the same as any other", writer.writes)
	}
}

// A third-party plugin (Builtin=false) is unaffected by the seeded
// rule -- its card-field write still asks, same as before this goal.
func TestSetCardFieldsForPlugin_ThirdPartyPluginStillAsks(t *testing.T) {
	svc, guard, writer := newCardFieldsHarness(t)

	type result struct {
		out PluginContentWriteResult
		err error
	}
	done := make(chan result, 1)
	go func() {
		out, err := svc.SetCardFieldsForPlugin("roadmapper", "card-1", map[string]string{"horizon": "Now"})
		done <- result{out, err}
	}()

	deadline := time.Now().Add(2 * time.Second)
	var pendingID string
	for time.Now().Before(deadline) {
		if pending := guard.PendingGuardedActions(); len(pending) == 1 {
			pendingID = pending[0].ID
			break
		}
		time.Sleep(time.Millisecond)
	}
	if pendingID == "" {
		t.Fatal("a third-party plugin's card-field write never parked for a human decision")
	}
	if err := guard.ResolveGuardedAction(pendingID, true); err != nil {
		t.Fatalf("ResolveGuardedAction: %v", err)
	}

	select {
	case r := <-done:
		if r.err != nil || !r.out.Approved {
			t.Fatalf("after approval: %+v %v", r.out, r.err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("SetCardFieldsForPlugin never unblocked after the human approved")
	}
	if len(writer.writes) != 1 {
		t.Errorf("writer.writes = %v, want exactly the approved write", writer.writes)
	}
}

// The capability is part of the registered vocabulary, so a manifest
// declaring it loads instead of failing as unknown.
func TestKnownCapabilities_RegistersEditCardFields(t *testing.T) {
	if !knownCapabilities["edit-card-fields"] {
		t.Error("edit-card-fields missing from the capability vocabulary")
	}
	root := t.TempDir()
	writePlugin(t, root, "declares", `{"id":"declares","name":"D","version":"1","capabilities":["edit-card-fields"]}`, nil)
	svc := New(root, nil, "1.0.0")
	infos, err := svc.ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range infos {
		if p.Manifest.ID == "declares" && p.Error != "" {
			t.Errorf("a manifest declaring edit-card-fields must load clean: %s", p.Error)
		}
	}
}
