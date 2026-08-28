package guardrailsvc

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// --- EvaluateAction/EvaluateStep: the extracted core against seeded rules ---

func TestEvaluateAction_NoRules_UsesClassDefault(t *testing.T) {
	g, _ := newTestGuardrailService(t)
	v := g.EvaluateAction("some-kind", map[string]string{}, guardrail.ClassExternal)
	if v.Effect != guardrail.EffectAllow && v.Effect != guardrail.EffectAsk {
		t.Fatalf("EvaluateAction() with no rules = %+v, want the external-class default (ask)", v)
	}
	if v.Effect != guardrail.EffectAsk {
		t.Errorf("EvaluateAction() with no rules = %+v, want ask (ClassExternal's default)", v)
	}
}

func TestEvaluateAction_KindFillsNodeTypeIDScope(t *testing.T) {
	g, _ := newTestGuardrailService(t)
	if _, err := g.CreateRule(guardrail.Rule{
		Label: "Allow this action kind", Effect: guardrail.EffectAllow, NodeTypeID: "plugin-write-file",
	}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}

	got := g.EvaluateAction("plugin-write-file", map[string]string{"path": "/tmp/x"}, guardrail.ClassExternal)
	if got.Effect != guardrail.EffectAllow || got.RuleLabel != "Allow this action kind" {
		t.Errorf("EvaluateAction(kind=plugin-write-file) = %+v, want the NodeTypeID-scoped rule to match by kind", got)
	}

	other := g.EvaluateAction("some-other-kind", nil, guardrail.ClassExternal)
	if other.Effect != guardrail.EffectAsk {
		t.Errorf("EvaluateAction(kind=some-other-kind) = %+v, want the ask default (rule scoped to a different kind must not match)", other)
	}
}

func TestEvaluateAction_DenyBeatsAskBeatsAllow(t *testing.T) {
	g, _ := newTestGuardrailService(t)
	for _, r := range []guardrail.Rule{
		{Label: "allow", Effect: guardrail.EffectAllow, NodeTypeID: "k"},
		{Label: "ask", Effect: guardrail.EffectAsk, NodeTypeID: "k"},
		{Label: "deny", Effect: guardrail.EffectDeny, NodeTypeID: "k"},
	} {
		if _, err := g.CreateRule(r); err != nil {
			t.Fatalf("CreateRule(%s): %v", r.Label, err)
		}
	}
	got := g.EvaluateAction("k", nil, guardrail.ClassExternal)
	if got.Effect != guardrail.EffectDeny || got.RuleLabel != "deny" {
		t.Errorf("EvaluateAction() = %+v, want deny to win over ask/allow", got)
	}
}

// --- RequestGuardedAction: allow/deny immediate paths ---

func TestRequestGuardedAction_Allow_ReturnsImmediately(t *testing.T) {
	g, _ := newTestGuardrailService(t)
	if _, err := g.CreateRule(guardrail.Rule{
		Label: "Allow it", Effect: guardrail.EffectAllow, NodeTypeID: "test-kind",
	}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}

	decision, err := g.RequestGuardedAction(context.Background(), GuardedAction{
		Kind: "test-kind", Attributes: map[string]string{"x": "1"}, Description: "do a thing", Source: "test-agent",
	})
	if err != nil {
		t.Fatalf("RequestGuardedAction: %v", err)
	}
	if !decision.Approved || decision.Effect != guardrail.EffectAllow || decision.RuleLabel != "Allow it" {
		t.Errorf("RequestGuardedAction() = %+v, want an immediate approved decision naming the allow rule", decision)
	}
}

func TestRequestGuardedAction_Deny_ReturnsImmediately(t *testing.T) {
	g, _ := newTestGuardrailService(t)
	if _, err := g.CreateRule(guardrail.Rule{
		Label: "Deny it", Effect: guardrail.EffectDeny, NodeTypeID: "test-kind",
	}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}

	decision, err := g.RequestGuardedAction(context.Background(), GuardedAction{Kind: "test-kind"})
	if err != nil {
		t.Fatalf("RequestGuardedAction: %v", err)
	}
	if decision.Approved || decision.Effect != guardrail.EffectDeny || decision.RuleLabel != "Deny it" {
		t.Errorf("RequestGuardedAction() = %+v, want an immediate denied decision naming the deny rule", decision)
	}
}

// --- RequestGuardedAction: ask parks, resolves, unblocks the caller ---

// awaitPending polls until exactly one action is parked (or fails the
// test) -- RequestGuardedAction parks asynchronously relative to the
// resolver goroutine below, so the test must observe the park before
// resolving it.
func awaitPending(t *testing.T, g *GuardrailService) PendingGuardedAction {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if pending := g.pendingGuardedActions(); len(pending) == 1 {
			return pending[0]
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("RequestGuardedAction never parked a PendingGuardedAction")
	return PendingGuardedAction{}
}

func TestRequestGuardedAction_Ask_ParkedThenApproved_UnblocksApproved(t *testing.T) {
	g, _ := newTestGuardrailService(t) // no rules -- ClassExternal defaults to ask

	type result struct {
		decision Decision
		err      error
	}
	done := make(chan result, 1)
	go func() {
		d, err := g.RequestGuardedAction(context.Background(), GuardedAction{
			Kind: "test-kind", Description: "needs a human", Source: "test-agent",
		})
		done <- result{d, err}
	}()

	pending := awaitPending(t, g)
	if pending.Description != "needs a human" || pending.Source != "test-agent" {
		t.Errorf("parked PendingGuardedAction = %+v, want the requested description/source carried through", pending)
	}
	if !g.resolveGuardedAction(pending.ID, true) {
		t.Fatal("resolveGuardedAction(approve) on the just-parked id: want true")
	}

	select {
	case r := <-done:
		if r.err != nil {
			t.Fatalf("RequestGuardedAction after approve: %v", r.err)
		}
		if !r.decision.Approved || r.decision.Effect != guardrail.EffectAsk {
			t.Errorf("RequestGuardedAction() after approve = %+v, want Approved=true, Effect=ask", r.decision)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("RequestGuardedAction never unblocked after resolveGuardedAction(approve)")
	}
	if pending := g.pendingGuardedActions(); len(pending) != 0 {
		t.Errorf("pendingGuardedActions() after resolution = %+v, want empty (unparked)", pending)
	}
}

func TestRequestGuardedAction_Ask_ParkedThenDenied_UnblocksDenied(t *testing.T) {
	g, _ := newTestGuardrailService(t)

	type result struct {
		decision Decision
		err      error
	}
	done := make(chan result, 1)
	go func() {
		d, err := g.RequestGuardedAction(context.Background(), GuardedAction{Kind: "test-kind"})
		done <- result{d, err}
	}()

	pending := awaitPending(t, g)
	if !g.resolveGuardedAction(pending.ID, false) {
		t.Fatal("resolveGuardedAction(deny) on the just-parked id: want true")
	}

	select {
	case r := <-done:
		if r.err != nil {
			t.Fatalf("RequestGuardedAction after deny: %v", r.err)
		}
		if r.decision.Approved {
			t.Errorf("RequestGuardedAction() after deny = %+v, want Approved=false", r.decision)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("RequestGuardedAction never unblocked after resolveGuardedAction(deny)")
	}
}

// --- RequestGuardedAction: ctx-cancel withdraws the pending action cleanly ---

func TestRequestGuardedAction_Ask_CtxCancel_WithdrawsCleanly(t *testing.T) {
	g, _ := newTestGuardrailService(t)
	ctx, cancel := context.WithCancel(context.Background())

	type result struct {
		decision Decision
		err      error
	}
	done := make(chan result, 1)
	go func() {
		d, err := g.RequestGuardedAction(ctx, GuardedAction{Kind: "test-kind"})
		done <- result{d, err}
	}()

	pending := awaitPending(t, g)
	cancel()

	select {
	case r := <-done:
		if !errors.Is(r.err, context.Canceled) {
			t.Errorf("RequestGuardedAction() after ctx-cancel err = %v, want context.Canceled", r.err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("RequestGuardedAction never unblocked after ctx-cancel")
	}
	if remaining := g.pendingGuardedActions(); len(remaining) != 0 {
		t.Errorf("pendingGuardedActions() after ctx-cancel = %+v, want the withdrawn action removed", remaining)
	}
	// A stale resolve arriving after the withdrawal must be a no-op, not
	// a panic on a closed/unknown channel.
	if g.resolveGuardedAction(pending.ID, true) {
		t.Error("resolveGuardedAction() on an already-withdrawn id: want false")
	}
}
