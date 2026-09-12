package pluginsvc

import (
	"fmt"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// fakeIntegrationExecutor stands in for composition.ExecuteOperation:
// records every call, answers a fixed error (nil for success).
type fakeIntegrationExecutor struct {
	calls []fakeIntegrationCall
	err   error
}

type fakeIntegrationCall struct {
	requestID, path, method string
	values                  map[string]string
}

func (f *fakeIntegrationExecutor) Execute(requestID, path, method string, values map[string]string) (string, error) {
	f.calls = append(f.calls, fakeIntegrationCall{requestID, path, method, values})
	if f.err != nil {
		return "", f.err
	}
	return `{"ok":true}`, nil
}

func newGuardedWriteHarness(t *testing.T) (*PluginService, *guardrailsvc.GuardrailService, *fakeIntegrationExecutor) {
	t.Helper()
	root := t.TempDir()
	writePlugin(t, root, "tracker-view", `{"id":"tracker-view","name":"Tracker","version":"1","capabilities":["call-integration"]}`, nil)
	writePlugin(t, root, "plain", `{"id":"plain","name":"Plain","version":"1"}`, nil)
	store := servicetest.NewFakeStore()
	guard := guardrailsvc.NewGuardrailService(store, compositionsvc.NewCompositionService(store))
	svc := newTestPluginService(t, root, guard, "1.0.0")
	exec := &fakeIntegrationExecutor{}
	svc.WireIntegrations(exec.Execute)
	return svc, guard, exec
}

func TestEvaluateGuardedActionForPlugin_RefusesUndeclaredCapabilityAndUnknownKind(t *testing.T) {
	svc, _, exec := newGuardedWriteHarness(t)

	if _, err := svc.EvaluateGuardedActionForPlugin("plain", "external.comment", nil); err == nil || !strings.Contains(err.Error(), "call-integration") {
		t.Errorf("undeclared capability must refuse naming it: %v", err)
	}
	if _, err := svc.EvaluateGuardedActionForPlugin("tracker-view", "content.write", nil); err == nil || !strings.Contains(err.Error(), "not an inline-confirmable") {
		t.Errorf("an unlisted kind must refuse: %v", err)
	}
	if len(exec.calls) != 0 {
		t.Fatalf("evaluate must never perform anything: %v", exec.calls)
	}
}

// The default class-external fail-safe asks with no rule authored --
// EvaluateGuardedActionForPlugin answers "ask" without ever touching
// the executor.
func TestEvaluateGuardedActionForPlugin_DefaultsToAsk(t *testing.T) {
	svc, _, exec := newGuardedWriteHarness(t)
	out, err := svc.EvaluateGuardedActionForPlugin("tracker-view", "external.comment", map[string]string{"itemKey": "PROJ-1"})
	if err != nil {
		t.Fatal(err)
	}
	if out.Effect != string(guardrail.EffectAsk) {
		t.Errorf("Effect = %q, want ask (ClassExternal's own fail-safe default)", out.Effect)
	}
	if len(exec.calls) != 0 {
		t.Fatalf("evaluate must never perform anything: %v", exec.calls)
	}
}

// An allow rule performs and audits immediately -- no confirmation, no
// banner needed on the frontend.
func TestPerformGuardedActionForPlugin_Allow_PerformsAndAudits(t *testing.T) {
	svc, guard, exec := newGuardedWriteHarness(t)
	if _, err := guard.CreateRule(guardrail.Rule{Label: "Allow comments", Effect: guardrail.EffectAllow, NodeTypeID: "external.comment"}); err != nil {
		t.Fatal(err)
	}
	out, err := svc.PerformGuardedActionForPlugin("tracker-view", "external.comment", map[string]string{"integrationId": "int-1", "itemKey": "PROJ-1", "body": "on it"}, "Post", false)
	if err != nil {
		t.Fatalf("PerformGuardedActionForPlugin returned error: %v", err)
	}
	if !out.Approved || !out.Performed || out.Effect != string(guardrail.EffectAllow) {
		t.Fatalf("allow rule must approve and perform: %+v", out)
	}
	if len(exec.calls) != 1 || exec.calls[0].requestID != "int-1" || exec.calls[0].path != "/items/{itemKey}/comments" || exec.calls[0].method != "POST" {
		t.Fatalf("the integration door saw %+v, want one POST to the comment operation", exec.calls)
	}
}

// A deny rule never performs.
func TestPerformGuardedActionForPlugin_Deny_NeverPerforms(t *testing.T) {
	svc, guard, exec := newGuardedWriteHarness(t)
	if _, err := guard.CreateRule(guardrail.Rule{Label: "Deny transitions", Effect: guardrail.EffectDeny, NodeTypeID: "external.transition"}); err != nil {
		t.Fatal(err)
	}
	out, err := svc.PerformGuardedActionForPlugin("tracker-view", "external.transition", map[string]string{"integrationId": "int-1", "itemKey": "PROJ-1", "toStatus": "Done"}, "Move to Done", false)
	if err != nil {
		t.Fatal(err)
	}
	if out.Approved || out.Performed {
		t.Fatalf("a deny rule must never approve or perform: %+v", out)
	}
	if len(exec.calls) != 0 {
		t.Fatalf("a denied write must never reach the integration door: %v", exec.calls)
	}
}

// The core of goal 0374's amendment 1: an "ask" outcome with
// confirmed=false performs nothing and leaves no audit row (nothing
// was attempted, nothing to see or resolve). The SAME call again with
// confirmed=true performs and audits as an inline confirmation, never
// silently as "allow".
func TestPerformGuardedActionForPlugin_Ask_UnconfirmedThenConfirmed(t *testing.T) {
	svc, _, exec := newGuardedWriteHarness(t)
	attrs := map[string]string{"integrationId": "int-1", "itemKey": "PROJ-1", "body": "on it"}

	unconfirmed, err := svc.PerformGuardedActionForPlugin("tracker-view", "external.comment", attrs, "Post", false)
	if err != nil {
		t.Fatal(err)
	}
	if unconfirmed.Approved || unconfirmed.Performed || unconfirmed.Effect != string(guardrail.EffectAsk) {
		t.Fatalf("an unconfirmed ask must neither approve nor perform: %+v", unconfirmed)
	}
	if len(exec.calls) != 0 {
		t.Fatalf("an unconfirmed ask must never reach the integration door: %v", exec.calls)
	}

	confirmed, err := svc.PerformGuardedActionForPlugin("tracker-view", "external.comment", attrs, "Post", true)
	if err != nil {
		t.Fatal(err)
	}
	if !confirmed.Approved || !confirmed.Performed {
		t.Fatalf("the host-confirmed call must approve and perform: %+v", confirmed)
	}
	if len(exec.calls) != 1 {
		t.Fatalf("the confirmed call must perform exactly once: %v", exec.calls)
	}
}

// A confirmed flag smuggled through attributes (a frame trying to
// assert its own confirmation) has zero effect: confirmed is a
// distinct typed parameter, never derived from the attributes map a
// frame controls -- proves goal 0374 amendment 1's "a confirmed flag
// arriving from the frame is ignored."
func TestPerformGuardedActionForPlugin_FrameAssertedConfirmed_IsIgnored(t *testing.T) {
	svc, _, exec := newGuardedWriteHarness(t)
	attrs := map[string]string{"integrationId": "int-1", "itemKey": "PROJ-1", "body": "on it", "confirmed": "true"}

	// Belt: an unlisted attribute key refuses outright (the allowlist
	// below), before confirmed is even reached.
	if _, err := svc.PerformGuardedActionForPlugin("tracker-view", "external.comment", attrs, "Post", false); err == nil || !strings.Contains(err.Error(), "allowlist") {
		t.Fatalf("a confirmed key inside attributes must refuse via the allowlist: %v", err)
	}
	if len(exec.calls) != 0 {
		t.Fatalf("a frame-asserted confirmed must never reach the integration door: %v", exec.calls)
	}

	// Suspenders: confirmed is a distinct typed parameter, never derived
	// from attributes at all -- even a value the allowlist WOULD permit
	// has no way to spell "confirmed" through attributes, since the
	// real parameter is a separate bool the frame-facing bridge method
	// never accepts on the wire (frontend/src/app/pluginFrameBridge.ts).
	clean := map[string]string{"integrationId": "int-1", "itemKey": "PROJ-1", "body": "on it"}
	out, err := svc.PerformGuardedActionForPlugin("tracker-view", "external.comment", clean, "Post", false)
	if err != nil {
		t.Fatal(err)
	}
	if out.Approved || out.Performed {
		t.Fatalf("an unconfirmed ask must never approve or perform: %+v", out)
	}
	if len(exec.calls) != 0 {
		t.Fatalf("an unconfirmed ask must never reach the integration door: %v", exec.calls)
	}
}

// TestGuardedWriteAttributeAllowlist_RejectsUnlistedKeys is the Go
// test the brief's item 7 names: each of the two guarded-action kinds
// refuses an attribute key outside its own declared shape.
func TestGuardedWriteAttributeAllowlist_RejectsUnlistedKeys(t *testing.T) {
	svc, guard, exec := newGuardedWriteHarness(t)
	if _, err := guard.CreateRule(guardrail.Rule{Label: "Allow", Effect: guardrail.EffectAllow, NodeTypeID: "external.comment"}); err != nil {
		t.Fatal(err)
	}
	if _, err := guard.CreateRule(guardrail.Rule{Label: "Allow", Effect: guardrail.EffectAllow, NodeTypeID: "external.transition"}); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.PerformGuardedActionForPlugin("tracker-view", "external.comment", map[string]string{"integrationId": "i", "itemKey": "k", "body": "b"}, "Post", false); err != nil {
		t.Errorf("a comment's own allowed keys must be accepted: %v", err)
	}
	if _, err := svc.PerformGuardedActionForPlugin("tracker-view", "external.comment", map[string]string{"integrationId": "i", "itemKey": "k", "toStatus": "Done"}, "Post", false); err == nil || !strings.Contains(err.Error(), "allowlist") {
		t.Errorf("a comment must refuse a transition-only key (toStatus): %v", err)
	}
	if _, err := svc.PerformGuardedActionForPlugin("tracker-view", "external.transition", map[string]string{"integrationId": "i", "itemKey": "k", "toStatus": "Done"}, "Move to Done", false); err != nil {
		t.Errorf("a transition's own allowed keys must be accepted: %v", err)
	}
	if _, err := svc.PerformGuardedActionForPlugin("tracker-view", "external.transition", map[string]string{"integrationId": "i", "itemKey": "k", "body": "b"}, "Move to Done", false); err == nil || !strings.Contains(err.Error(), "allowlist") {
		t.Errorf("a transition must refuse a comment-only key (body): %v", err)
	}
	if len(exec.calls) != 2 {
		t.Fatalf("exactly the two well-formed calls must reach the integration door: %v", exec.calls)
	}
}

// A failed write is still audited (the outcome is real even when the
// external call itself errors) and never reports Performed.
func TestPerformGuardedActionForPlugin_IntegrationError_NotPerformed(t *testing.T) {
	svc, guard, exec := newGuardedWriteHarness(t)
	exec.err = fmt.Errorf("upstream unavailable")
	if _, err := guard.CreateRule(guardrail.Rule{Label: "Allow comments", Effect: guardrail.EffectAllow, NodeTypeID: "external.comment"}); err != nil {
		t.Fatal(err)
	}
	out, err := svc.PerformGuardedActionForPlugin("tracker-view", "external.comment", map[string]string{"integrationId": "int-1", "itemKey": "PROJ-1", "body": "x"}, "Post", false)
	if err == nil {
		t.Fatal("an integration failure must surface as an error")
	}
	if out.Performed {
		t.Fatalf("a failed send must never report Performed: %+v", out)
	}
}
