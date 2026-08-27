package guardrailsvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// TestShellCommandVerdicts_SeededAllowList_SkipsTheDefaultAsk proves
// goal 0240 S3's default allow list actually reaches a fresh install:
// a read-only shape named in the seed (curl -I) resolves to allow, with
// no approval ceremony needed, where the effect-class default (external
// steps ask) would otherwise apply.
func TestShellCommandVerdicts_SeededAllowList_SkipsTheDefaultAsk(t *testing.T) {
	g, _ := newTestGuardrailService(t)
	g.rules = guardrail.BuiltIn() // fresh install's own seeded set, not the test helper's cleared one

	verdicts := g.ShellCommandVerdicts([]string{"curl -I https://example.test"})
	if verdicts[0].Effect != guardrail.EffectAllow || verdicts[0].RuleID != guardrail.ShellAllowCurlHeadRuleID {
		t.Fatalf("verdict = %+v, want allow by %s", verdicts[0], guardrail.ShellAllowCurlHeadRuleID)
	}
}

// TestShellCommandVerdicts_SeededDenyList_ParksForApproval proves the
// seed's default deny (Ask-mapped, "bypass = approve") list catches a
// dangerous shape, distinctly from the plain effect-class default ask
// (a named rule label, not an empty one).
func TestShellCommandVerdicts_SeededDenyList_ParksForApproval(t *testing.T) {
	g, _ := newTestGuardrailService(t)
	g.rules = guardrail.BuiltIn()

	verdicts := g.ShellCommandVerdicts([]string{"rm -rf /tmp/whatever"})
	if verdicts[0].Effect != guardrail.EffectAsk || verdicts[0].RuleID != guardrail.ShellDenyRmRfRuleID {
		t.Fatalf("verdict = %+v, want ask by %s", verdicts[0], guardrail.ShellDenyRmRfRuleID)
	}
}

// TestShellCommandVerdicts_UnlistedCommand_FallsBackToTheClassDefault
// proves a command matching neither list keeps today's S1 behavior
// unchanged: external steps ask, with no rule attributed.
func TestShellCommandVerdicts_UnlistedCommand_FallsBackToTheClassDefault(t *testing.T) {
	g, _ := newTestGuardrailService(t)
	g.rules = guardrail.BuiltIn()

	verdicts := g.ShellCommandVerdicts([]string{"echo hello"})
	if verdicts[0].Effect != guardrail.EffectAsk || verdicts[0].RuleID != "" {
		t.Fatalf("verdict = %+v, want the plain class default (ask, no rule)", verdicts[0])
	}
}
