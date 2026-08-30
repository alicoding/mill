package guardrailsvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
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

// TestShellCommandVerdicts_AdminRun_UpgradesAllowToAsk pins goal 0240
// S5's fail-safe policy at the shared preview/gate seam: with the
// seeded shell step configured runWithAdmin, even a command matching a
// seeded ALLOW rule reports ask -- privilege is never auto-granted by a
// pattern list -- while a deny-listed shape keeps its own rule
// attribution unchanged.
func TestShellCommandVerdicts_AdminRun_UpgradesAllowToAsk(t *testing.T) {
	g, comp := newTestGuardrailService(t)
	g.rules = guardrail.BuiltIn()

	var loop composition.Workflow
	for _, w := range comp.Workflows() {
		if w.ID == composition.CodingLoopWorkflowID {
			loop = w
		}
	}
	if loop.ID == "" {
		t.Fatal("seeded coding-loop workflow missing from the test composition service")
	}
	for i := range loop.Nodes {
		if loop.Nodes[i].ID == composition.CodingLoopShellStepID {
			if loop.Nodes[i].Config == nil {
				loop.Nodes[i].Config = map[string]string{}
			}
			loop.Nodes[i].Config["runWithAdmin"] = "true"
		}
	}
	if _, err := comp.UpdateWorkflow(loop.ID, loop.Label, loop.Description, loop.Nodes, loop.Edges); err != nil {
		t.Fatalf("UpdateWorkflow: %v", err)
	}

	verdicts := g.ShellCommandVerdicts([]string{"curl -I https://example.test", "rm -rf /tmp/whatever"})
	if verdicts[0].Effect != guardrail.EffectAsk || verdicts[0].RuleLabel != "Runs with admin rights" {
		t.Fatalf("allow-listed verdict = %+v, want the admin ask upgrade", verdicts[0])
	}
	if verdicts[1].Effect != guardrail.EffectAsk || verdicts[1].RuleID != guardrail.ShellDenyRmRfRuleID {
		t.Fatalf("deny-listed verdict = %+v, want the deny rule's own attribution unchanged", verdicts[1])
	}
}
