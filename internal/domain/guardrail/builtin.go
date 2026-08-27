package guardrail

import "github.com/alicoding/mill/internal/domain/seedorigin"

// ExampleSecretGuardRuleID is the seeded example guardrail rule's ID --
// exported so a test/UI affordance can reference it without a string
// literal that could drift, same pattern mcpserver.ExampleReferenceServerID
// et al. already establish.
const ExampleSecretGuardRuleID = "example-secret-guard-rule"

// exampleSecretGuardWorkflowID/exampleSecretGuardStepID mirror
// composition.ExampleSecretGuardWorkflowID/ExampleSecretGuardStepID
// (internal/domain/composition/builtinworkflows_secretguard.go) as
// literal strings rather than an import: composition already imports
// this package (decisionoutcome.go's NodeAlwaysParks/EffectForNode), so
// a guardrail -> composition import back would cycle.
const (
	exampleSecretGuardWorkflowID = "example-secret-guard-workflow"
	exampleSecretGuardStepID     = "example-secret-guard-step"
)

// shellCommandNodeTypeID mirrors composition's "process-shell-command"
// NodeType ID as a literal string, same reason as
// exampleSecretGuardWorkflowID above (avoiding a guardrail->composition
// import cycle). The IDs below are node-TYPE scoped, not instance-
// scoped: they apply to every process-shell-command step anywhere,
// coding-loop seed included, matching the Claude-Code-hooks precedent
// this feature adopts (docs/goals/0240 session answer #4) of one global
// allow/deny list, not a per-workflow one.
const shellCommandNodeTypeID = "process-shell-command"

// The coding loop's default allow/deny pattern-list rules (goal 0240
// S3): ordinary guardrail.Rule records -- no separate list entity, no
// second matcher. Each Condition is a plain expr-lang boolean over
// Attributes["command"] (GuardrailStep's own per-step derivation,
// guardrailsvc.ShellCommandVerdicts), using expr-lang's built-in
// startsWith/contains/matches string operators -- deterministic,
// already-vetted (Decision-edge conditions use the same engine), no new
// matching code. DENY-listed shapes use EffectAsk, not EffectDeny:
// Mill's EffectDeny is an unconditional hard block with no approval
// path (executionservice_guardrail.go's guardrailGate) -- a "deny
// listed" command needs to remain overridable by an explicit approve,
// which only EffectAsk's park-for-approval flow provides. These are
// ordinary rules: fully visible/editable/deletable
// through the existing guardrail Rules surface (goal 0078's three-door
// model), same as any user-authored rule.
const (
	ShellAllowCurlHeadRuleID      = "shell-allow-curl-head"
	ShellAllowLsRuleID            = "shell-allow-ls"
	ShellAllowOpensslVerifyRuleID = "shell-allow-openssl-s-client"
	ShellDenyRmRfRuleID           = "shell-deny-rm-rf"
	ShellDenyPipeToShellRuleID    = "shell-deny-pipe-to-shell"
)

// BuiltIn returns the seeded example guardrail rules -- goal 0203 S2's
// "uses a stored secret" proof, plus goal 0240 S3's default shell
// allow/deny lists.
func BuiltIn() []Rule {
	return []Rule{
		{
			ID:         ExampleSecretGuardRuleID,
			Label:      "Uses a stored secret",
			Effect:     EffectAsk,
			WorkflowID: exampleSecretGuardWorkflowID,
			NodeID:     exampleSecretGuardStepID,
			Condition:  `len(Attributes["secrets"]) > 0`,
			BuiltIn:    true,
			Seed:       seedorigin.Stamp(1),
		},
		{
			ID:         ShellAllowCurlHeadRuleID,
			Label:      "Read-only: curl -I / --head",
			Effect:     EffectAllow,
			NodeTypeID: shellCommandNodeTypeID,
			Condition:  `Attributes.command startsWith "curl -I" or Attributes.command startsWith "curl --head"`,
			BuiltIn:    true,
			Seed:       seedorigin.Stamp(1),
		},
		{
			ID:         ShellAllowLsRuleID,
			Label:      "Read-only: ls",
			Effect:     EffectAllow,
			NodeTypeID: shellCommandNodeTypeID,
			Condition:  `Attributes.command matches "^ls( |$)"`,
			BuiltIn:    true,
			Seed:       seedorigin.Stamp(1),
		},
		{
			ID:         ShellAllowOpensslVerifyRuleID,
			Label:      "Read-only: openssl s_client",
			Effect:     EffectAllow,
			NodeTypeID: shellCommandNodeTypeID,
			Condition:  `Attributes.command startsWith "openssl s_client"`,
			BuiltIn:    true,
			Seed:       seedorigin.Stamp(1),
		},
		{
			ID:         ShellDenyRmRfRuleID,
			Label:      "Destructive: rm -rf",
			Effect:     EffectAsk,
			NodeTypeID: shellCommandNodeTypeID,
			Condition:  `Attributes.command contains "rm -rf" or Attributes.command contains "rm -fr"`,
			BuiltIn:    true,
			Seed:       seedorigin.Stamp(1),
		},
		{
			ID:         ShellDenyPipeToShellRuleID,
			Label:      "Piping a download into a shell",
			Effect:     EffectAsk,
			NodeTypeID: shellCommandNodeTypeID,
			Condition:  `Attributes.command contains "| sh" or Attributes.command contains "|sh" or Attributes.command contains "| bash" or Attributes.command contains "|bash"`,
			BuiltIn:    true,
			Seed:       seedorigin.Stamp(1),
		},
	}
}
