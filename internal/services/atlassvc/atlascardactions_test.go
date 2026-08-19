package atlassvc

import (
	"strings"

	"github.com/alicoding/mill/internal/domain/typedfield"
	"testing"

	"github.com/alicoding/mill/internal/services/servicetest"
)

func TestSetCardActions_DedupesAndRoundTrips(t *testing.T) {
	store := servicetest.NewFakeStore()
	a := NewAtlasService(store)
	card, err := a.CreateCard(a.Kinds()[0].ID, "Action host", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	got, err := a.SetCardActions(card.ID, []string{"wf-1", "", "wf-2", "wf-1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.ActionWorkflowIDs) != 2 || got.ActionWorkflowIDs[0] != "wf-1" || got.ActionWorkflowIDs[1] != "wf-2" {
		t.Fatalf("actions = %v, want deduped [wf-1 wf-2]", got.ActionWorkflowIDs)
	}
	b := NewAtlasService(store)
	for _, c := range b.Cards() {
		if c.ID == card.ID && len(c.ActionWorkflowIDs) == 2 {
			return
		}
	}
	t.Fatal("actions did not round-trip through persistence")
}

func TestRestore_MigratesRefreshWorkflowIntoActions(t *testing.T) {
	store := servicetest.NewFakeStore()
	a := NewAtlasService(store)
	card, err := a.CreateCard(a.Kinds()[0].ID, "Legacy refresh", "", nil, "", nil, "", "", "", "wf-legacy")
	if err != nil {
		t.Fatal(err)
	}
	b := NewAtlasService(store)
	for _, c := range b.Cards() {
		if c.ID == card.ID {
			if c.RefreshWorkflowID != "" {
				t.Fatalf("RefreshWorkflowID = %q, want migrated away", c.RefreshWorkflowID)
			}
			if len(c.ActionWorkflowIDs) != 1 || c.ActionWorkflowIDs[0] != "wf-legacy" {
				t.Fatalf("actions = %v, want [wf-legacy]", c.ActionWorkflowIDs)
			}
			return
		}
	}
	t.Fatal("card not found after restore")
}

func TestRunCardAction_ValidatesMembershipAndFiresSeam(t *testing.T) {
	a := NewAtlasService(servicetest.NewFakeStore())
	card, err := a.CreateCard(a.Kinds()[0].ID, "Runner host", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.SetCardActions(card.ID, []string{"wf-attached"}); err != nil {
		t.Fatal(err)
	}
	var gotWorkflow, gotCard, gotChange string
	prev := cardActionRunnerFn
	cardActionRunnerFn = func(workflowID, sourceCardID string, values map[string]string, payload string) error {
		gotWorkflow, gotCard, gotChange = workflowID, sourceCardID, values["changeType"]
		return nil
	}
	defer func() { cardActionRunnerFn = prev }()

	if err := a.RunCardAction(card.ID, "wf-not-attached"); err == nil {
		t.Fatal("unattached workflow must be rejected")
	}
	if err := a.RunCardAction(card.ID, "wf-attached"); err != nil {
		t.Fatal(err)
	}
	if gotWorkflow != "wf-attached" || gotCard != card.ID || gotChange != "action" {
		t.Fatalf("seam got (%q,%q,%q)", gotWorkflow, gotCard, gotChange)
	}
}

// goal 0126 slice 1: an attached action's run receives the card's own
// context -- source URL and typed field values -- so an action like
// "refresh this page" gets its URL without a find step.
func TestRunCardAction_CardContextFlowsIntoTheRun(t *testing.T) {
	a := NewAtlasService(servicetest.NewFakeStore())
	kind, err := a.CreateKind("Mirrored page", "", "", []typedfield.Field{{Key: "owner", Label: "Owner", Type: typedfield.TypeText}})
	if err != nil {
		t.Fatal(err)
	}
	card, err := a.CreateCard(kind.ID, "Page mirror", "", map[string]string{"owner": "me"}, "", nil, "", "https://wiki.example.invalid/page/42", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.SetCardActions(card.ID, []string{"wf-refresh"}); err != nil {
		t.Fatal(err)
	}
	var gotValues map[string]string
	var gotPayload string
	prev := cardActionRunnerFn
	cardActionRunnerFn = func(_, _ string, values map[string]string, payload string) error {
		gotValues, gotPayload = values, payload
		return nil
	}
	defer func() { cardActionRunnerFn = prev }()

	if err := a.RunCardAction(card.ID, "wf-refresh"); err != nil {
		t.Fatal(err)
	}
	if gotValues["sourceUrl"] != "https://wiki.example.invalid/page/42" {
		t.Errorf("sourceUrl = %q", gotValues["sourceUrl"])
	}
	if gotValues["field:owner"] != "me" {
		t.Errorf("field:owner = %q", gotValues["field:owner"])
	}
	if !strings.Contains(gotPayload, "wiki.example.invalid/page/42") {
		t.Errorf("payload missing source url: %s", gotPayload)
	}
}
