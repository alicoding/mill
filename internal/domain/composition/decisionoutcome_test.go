package composition

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/domain/httprequest"
)

func withDecisionLookup(t *testing.T, fn func(id string, pinnedVersion int) (ResolvedDecision, error)) {
	t.Helper()
	orig := lookupDecisionFn
	lookupDecisionFn = fn
	t.Cleanup(func() { lookupDecisionFn = orig })
}

func approveDecision() ResolvedDecision {
	return ResolvedDecision{
		Label: "Approve", Category: string(decision.CategoryApprove),
		Outputs: []decision.OutputField{
			{Key: "decision", Label: "Decision", Type: "text", Options: []string{"APPROVED", "DECLINED"}},
			{Key: "score", Label: "Score", Type: "number"},
		},
	}
}

// A decision-outcome node terminates the graph with a typed
// {category, decision, outputs} JSON payload -- the actual mechanism
// docs/adr/0027 names. A number output bound to an "attr:" reference
// stays a real JSON number, not a stringified one.
func TestExecuteWorkflow_DecisionOutcome_TypedOutcomeJSON(t *testing.T) {
	withDecisionLookup(t, func(id string, pinnedVersion int) (ResolvedDecision, error) {
		if id != "dec-1" {
			t.Errorf("lookupDecisionFn called with id %q, want dec-1", id)
		}
		if pinnedVersion != 0 {
			t.Errorf("lookupDecisionFn called with pinnedVersion %d, want 0 (no version config)", pinnedVersion)
		}
		return approveDecision(), nil
	})

	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t1", NodeTypeID: "trigger-manual"},
		{ID: "n1", NodeTypeID: "decision-outcome", Config: map[string]string{
			"decisionId":     "dec-1",
			"outputBindings": `{"decision":"APPROVED","score":"attr:amount"}`,
		}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	edges := []Edge{{ID: "e1", Source: "t1", Target: "n1"}}
	attrs := []AttributeDef{{Key: "amount", Label: "Amount", Type: FieldNumber}}

	result, err := ExecuteWorkflow(nodes, edges, attrs, ExecuteOptions{AttrValues: map[string]string{"amount": "150"}})
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}

	var got struct {
		Category string         `json:"category"`
		Decision string         `json:"decision"`
		Outputs  map[string]any `json:"outputs"`
	}
	if err := json.Unmarshal([]byte(result), &got); err != nil {
		t.Fatalf("result is not valid JSON: %v (%s)", err, result)
	}
	if got.Category != "approve" || got.Decision != "Approve" {
		t.Errorf("category/decision = %q/%q, want approve/Approve", got.Category, got.Decision)
	}
	if got.Outputs["decision"] != "APPROVED" {
		t.Errorf("outputs.decision = %v, want APPROVED", got.Outputs["decision"])
	}
	score, ok := got.Outputs["score"].(float64)
	if !ok || score != 150 {
		t.Errorf("outputs.score = %v (%T), want a JSON number 150", got.Outputs["score"], got.Outputs["score"])
	}
}

// A declared output field with no binding at all still appears in the
// outcome, zero-valued for its type -- the outcome always reflects the
// Decision's full declared contract.
func TestExecuteWorkflow_DecisionOutcome_UnboundOutputDefaultsToZeroValue(t *testing.T) {
	withDecisionLookup(t, func(string, int) (ResolvedDecision, error) {
		return approveDecision(), nil
	})

	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t1", NodeTypeID: "trigger-manual"},
		{ID: "n1", NodeTypeID: "decision-outcome", Config: map[string]string{"decisionId": "dec-1"}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	result, err := ExecuteWorkflow(nodes, []Edge{{ID: "e1", Source: "t1", Target: "n1"}}, nil)
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	var got struct {
		Outputs map[string]any `json:"outputs"`
	}
	if err := json.Unmarshal([]byte(result), &got); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if got.Outputs["decision"] != "" {
		t.Errorf("unbound text output = %v, want empty string zero value", got.Outputs["decision"])
	}
	if got.Outputs["score"] != 0.0 {
		t.Errorf("unbound number output = %v, want 0", got.Outputs["score"])
	}
}

var errFakeNoDecision = errors.New("no such decision")

func TestExecuteWorkflow_DecisionOutcome_UnknownDecision_Rejected(t *testing.T) {
	withDecisionLookup(t, func(string, int) (ResolvedDecision, error) {
		return ResolvedDecision{}, errFakeNoDecision
	})
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t1", NodeTypeID: "trigger-manual"},
		{ID: "n1", NodeTypeID: "decision-outcome", Config: map[string]string{"decisionId": "missing"}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	if _, err := ExecuteWorkflow(nodes, []Edge{{ID: "e1", Source: "t1", Target: "n1"}}, nil); err == nil {
		t.Error("ExecuteWorkflow with an unknown decisionId returned nil error, want an error")
	}
}

// A webhook-bearing Decision fires the referenced HTTPRequest AFTER the
// outcome is computed, through the same transport helper integration-http
// uses (sendHTTPRequest) -- the body is the outcome's outputs JSON, not
// the whole envelope.
func TestExecuteWorkflow_DecisionOutcome_WebhookFiresWithOutputsJSON(t *testing.T) {
	var gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	withDecisionLookup(t, func(string, int) (ResolvedDecision, error) {
		d := approveDecision()
		d.WebhookRequestID = "webhook-req"
		return d, nil
	})
	withHTTPRequestLookup(t, func(id string) (ResolvedHTTPRequest, error) {
		if id != "webhook-req" {
			t.Errorf("webhook lookup called with id %q, want webhook-req", id)
		}
		return ResolvedHTTPRequest{BaseURL: srv.URL, Method: http.MethodPost, AuthType: httprequest.AuthNone}, nil
	})

	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t1", NodeTypeID: "trigger-manual"},
		{ID: "n1", NodeTypeID: "decision-outcome", Config: map[string]string{
			"decisionId": "dec-1", "outputBindings": `{"score":"90"}`,
		}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	if _, err := ExecuteWorkflow(nodes, []Edge{{ID: "e1", Source: "t1", Target: "n1"}}, nil); err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	var body struct {
		Score float64 `json:"score"`
	}
	if err := json.Unmarshal([]byte(gotBody), &body); err != nil {
		t.Fatalf("webhook body is not valid JSON: %v (%s)", err, gotBody)
	}
	if body.Score != 90 {
		t.Errorf("webhook body score = %v, want 90", body.Score)
	}
}

// A webhook delivery failure fails the whole step -- fail-safe, and
// redrivable like any other node failure, not silently swallowed.
func TestExecuteWorkflow_DecisionOutcome_WebhookFailure_FailsStep(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	withDecisionLookup(t, func(string, int) (ResolvedDecision, error) {
		d := approveDecision()
		d.WebhookRequestID = "webhook-req"
		return d, nil
	})
	withHTTPRequestLookup(t, func(string) (ResolvedHTTPRequest, error) {
		return ResolvedHTTPRequest{BaseURL: srv.URL, AuthType: httprequest.AuthNone}, nil
	})

	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t1", NodeTypeID: "trigger-manual"},
		{ID: "n1", NodeTypeID: "decision-outcome", Config: map[string]string{"decisionId": "dec-1"}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	if _, err := ExecuteWorkflow(nodes, []Edge{{ID: "e1", Source: "t1", Target: "n1"}}, nil); err == nil {
		t.Error("ExecuteWorkflow with a failing webhook returned nil error, want an error")
	}
}

// EffectForNode is the dynamic-effect hook docs/adr/0027 requires: a
// decision-outcome node without a webhook asks like any other local
// step (never, by default); with a webhook, it asks exactly like
// integration-http does for the same kind of outbound call. Every
// other NodeType's effect is untouched (falls through to the static
// NodeTypeEffect answer).
func TestEffectForNode_DecisionOutcome_DynamicByWebhook(t *testing.T) {
	withDecisionLookup(t, func(id string, pinnedVersion int) (ResolvedDecision, error) {
		if id == "with-webhook" {
			return ResolvedDecision{Category: "approve", WebhookRequestID: "req-1"}, nil
		}
		return ResolvedDecision{Category: "approve"}, nil
	})

	local := Node{NodeTypeID: "decision-outcome", Config: map[string]string{"decisionId": "no-webhook"}}
	if got := EffectForNode(local); got != guardrail.ClassLocal {
		t.Errorf("EffectForNode(no webhook) = %q, want local", got)
	}
	external := Node{NodeTypeID: "decision-outcome", Config: map[string]string{"decisionId": "with-webhook"}}
	if got := EffectForNode(external); got != guardrail.ClassExternal {
		t.Errorf("EffectForNode(with webhook) = %q, want external", got)
	}

	// Unaffected: a normal NodeType's effect is the static declared
	// class, same as calling NodeTypeEffect directly.
	other := Node{NodeTypeID: "integration-http"}
	if got, want := EffectForNode(other), NodeTypeEffect("integration-http"); got != want {
		t.Errorf("EffectForNode(integration-http) = %q, want %q (NodeTypeEffect's static answer)", got, want)
	}
}

// A decision-outcome node's optional "version" config is parsed and
// passed through to the lookup seam unchanged (docs/adr/0040 decision
// 4) -- the resolved outcome's audit stamp (decision 5) lands in the
// outcome JSON's own "resolvedVersion" key, the run's recorded Payload.
func TestExecuteWorkflow_DecisionOutcome_PinnedVersion_PassedToLookupAndStamped(t *testing.T) {
	withDecisionLookup(t, func(id string, pinnedVersion int) (ResolvedDecision, error) {
		if pinnedVersion != 3 {
			t.Errorf("lookupDecisionFn called with pinnedVersion %d, want 3 (the node's own version config)", pinnedVersion)
		}
		rd := approveDecision()
		rd.Version = "v3"
		return rd, nil
	})

	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t1", NodeTypeID: "trigger-manual"},
		{ID: "n1", NodeTypeID: "decision-outcome", Config: map[string]string{"decisionId": "dec-1", "version": "3"}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	result, err := ExecuteWorkflow(nodes, []Edge{{ID: "e1", Source: "t1", Target: "n1"}}, nil)
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	var got struct {
		ResolvedVersion string `json:"resolvedVersion"`
	}
	if err := json.Unmarshal([]byte(result), &got); err != nil {
		t.Fatalf("result is not valid JSON: %v (%s)", err, result)
	}
	if got.ResolvedVersion != "v3" {
		t.Errorf("resolvedVersion = %q, want v3", got.ResolvedVersion)
	}
}

// A non-numeric or non-positive "version" config is rejected at
// execution time, same fail-safe shape child-workflow's own version
// pin already establishes -- never silently treated as unpinned.
func TestExecuteWorkflow_DecisionOutcome_InvalidVersionConfig_Rejected(t *testing.T) {
	withDecisionLookup(t, func(string, int) (ResolvedDecision, error) {
		return approveDecision(), nil
	})
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t1", NodeTypeID: "trigger-manual"},
		{ID: "n1", NodeTypeID: "decision-outcome", Config: map[string]string{"decisionId": "dec-1", "version": "not-a-number"}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	if _, err := ExecuteWorkflow(nodes, []Edge{{ID: "e1", Source: "t1", Target: "n1"}}, nil); err == nil {
		t.Error("ExecuteWorkflow with a non-numeric version config returned nil error, want an error")
	}
}

// Regression: an unset Decision ref executed into the lookup and
// surfaced `no decision with id ""` -- machine-speak quoting an empty
// string. The step must fail with copy that says what to fix.
func TestExecuteWorkflow_DecisionOutcome_EmptyDecisionRef_ExplainsWhatToFix(t *testing.T) {
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t1", NodeTypeID: "trigger-manual"},
		{ID: "n1", NodeTypeID: "decision-outcome", Config: map[string]string{}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	_, err = ExecuteWorkflow(nodes, []Edge{{ID: "e1", Source: "t1", Target: "n1"}}, nil)
	if err == nil {
		t.Fatal("expected an error for an unset Decision ref")
	}
	if !strings.Contains(err.Error(), "choose which Decision") || strings.Contains(err.Error(), `""`) {
		t.Errorf("error must be user copy, never a quoted empty id: %v", err)
	}
}
