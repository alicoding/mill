package atlassvc

import "testing"

// Recognition is a host match against configured Integrations (goal
// 0126): the card's Source hostname against each Integration's
// base-URL hostname, case-insensitive, port-insensitive on the card
// side (Hostname() strips ports on both).
func TestCardSourceOffer_HostMatchListsOfferedWorkflows(t *testing.T) {
	a := newTestAtlasService(t)
	kind := firstKindWithLabel(t, a, "Document")
	card, err := a.CreateCard(kind, "A wiki page", "", nil, "", nil, "", "https://Wiki.Corp.Example:8443/pages/12345", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}

	a.WireSourceRecognition(
		func() []RecognizedIntegration {
			return []RecognizedIntegration{
				{RequestID: "req-other", Label: "Jira", Host: "jira.corp.example"},
				{RequestID: "req-wiki", Label: "Confluence (PAT)", Host: "wiki.corp.example"},
			}
		},
		func(requestID string) []OfferedAction {
			if requestID != "req-wiki" {
				t.Errorf("offer lookup asked for %q, want the matched req-wiki", requestID)
			}
			return []OfferedAction{{WorkflowID: "wf-refresh", Label: "Refresh from Confluence"}}
		},
	)

	offer, err := a.CardSourceOffer(card.ID)
	if err != nil {
		t.Fatalf("CardSourceOffer: %v", err)
	}
	if !offer.Recognized || offer.RequestID != "req-wiki" || offer.Label != "Confluence (PAT)" {
		t.Errorf("offer = %+v, want recognized req-wiki", offer)
	}
	if len(offer.Workflows) != 1 || offer.Workflows[0].WorkflowID != "wf-refresh" {
		t.Errorf("offered workflows = %+v, want the declared refresh workflow", offer.Workflows)
	}
}

func TestCardSourceOffer_NoMatchAndNoSourceStayUnrecognized(t *testing.T) {
	a := newTestAtlasService(t)
	kind := firstKindWithLabel(t, a, "Document")
	a.WireSourceRecognition(
		func() []RecognizedIntegration {
			return []RecognizedIntegration{{RequestID: "r", Label: "X", Host: "elsewhere.example"}}
		},
		func(string) []OfferedAction { return nil },
	)

	noSource, err := a.CreateCard(kind, "No source", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if offer, _ := a.CardSourceOffer(noSource.ID); offer.Recognized {
		t.Errorf("source-less card recognized: %+v", offer)
	}

	otherHost, err := a.CreateCard(kind, "Other host", "", nil, "", nil, "", "https://unrelated.example/x", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if offer, _ := a.CardSourceOffer(otherHost.ID); offer.Recognized {
		t.Errorf("non-matching host recognized: %+v", offer)
	}
}

// An offered workflow is runnable without prior attachment -- the
// declaration on the workflow's side is the authorization
// (RunCardAction's second legality path). An undeclared workflow still
// refuses.
func TestRunCardAction_OfferedWorkflowRunsWithoutAttachment(t *testing.T) {
	a := newTestAtlasService(t)
	kind := firstKindWithLabel(t, a, "Document")
	card, err := a.CreateCard(kind, "Wiki page", "", nil, "", nil, "", "https://wiki.corp.example/pages/1", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	a.WireSourceRecognition(
		func() []RecognizedIntegration {
			return []RecognizedIntegration{{RequestID: "req-wiki", Label: "Confluence", Host: "wiki.corp.example"}}
		},
		func(string) []OfferedAction {
			return []OfferedAction{{WorkflowID: "wf-offered", Label: "Refresh"}}
		},
	)
	ran := ""
	prev := cardActionRunnerFn
	SetCardActionRunner(func(workflowID, sourceCardID string, values map[string]string, payload string) error {
		ran = workflowID
		return nil
	})
	defer SetCardActionRunner(prev)

	if err := a.RunCardAction(card.ID, "wf-offered"); err != nil {
		t.Fatalf("offered workflow refused: %v", err)
	}
	if ran != "wf-offered" {
		t.Errorf("runner got %q, want wf-offered", ran)
	}
	if err := a.RunCardAction(card.ID, "wf-not-declared"); err == nil {
		t.Error("undeclared workflow ran without attachment or offer")
	}
}
