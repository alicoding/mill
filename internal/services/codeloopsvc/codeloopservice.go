// Package codeloopsvc is the Wails-facing layer for the coding loop's
// Confirm screen (docs/goals/0240 S1): turning a captured clipboard
// block into the exact preview the frontend renders BEFORE anything
// runs -- the parsed step structure, the resolved shell/cwd target, and
// the guardrail verdict, computed the SAME way the real run will
// (composition.ParseShellCommandBlock/ResolveShellCommandTarget,
// guardrail.Evaluate against the seeded workflow's own node), so the
// Confirm screen and the actual execution never disagree
// (.claude/rules/backend.md: a Wails-bound service owns no domain logic
// of its own, only the RPC shape over what composition/guardrail
// already compute).
package codeloopsvc

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
)

// CommandBlockPreviewStep is one parsed step, in the exact shape the
// Confirm screen renders -- Join mirrors composition.CommandJoin's own
// string values ("" | "newline" | "and") so the frontend needs no
// second enum.
type CommandBlockPreviewStep struct {
	Index                      int    `json:"index"`
	Text                       string `json:"text"`
	Join                       string `json:"join"`
	LooksLikeSecretPlaceholder bool   `json:"looksLikeSecretPlaceholder"`
	// Verdict/RuleLabel (goal 0240 S3) are this ONE step's own guardrail
	// verdict -- "allow" | "ask" | "deny", matching CommandBlockPreview's
	// own GuardrailVerdict values. RuleLabel is empty when the
	// effect-class default decided (no allow/deny-list pattern matched);
	// the Confirm screen only renders a per-step badge when it's
	// non-empty, so an unlisted step stays exactly as quiet as it was
	// before this slice.
	Verdict   string `json:"verdict"`
	RuleLabel string `json:"ruleLabel,omitempty"`
}

// CommandBlockPreview is PreviewCommandBlock's full return shape.
type CommandBlockPreview struct {
	Steps []CommandBlockPreviewStep `json:"steps"`
	Shell string                    `json:"shell"`
	Dir   string                    `json:"dir"`
	// GuardrailVerdict is "allow" | "ask" | "deny" -- the block-level
	// gate decision (goal 0240 S3): the MOST RESTRICTIVE of every step's
	// own Verdict below, since the block still checkpoints/pauses as ONE
	// DBOS step (composition/executeshellcommand.go's own one-step-per-
	// node design). Each CommandBlockPreviewStep now carries its OWN
	// verdict too -- this field is what actually decides whether Run
	// pauses for approval, the per-step ones are display only.
	GuardrailVerdict string `json:"guardrailVerdict"`
	// WorkflowID/NodeID name which real seeded workflow/node the
	// frontend will call RunWorkflowWithPayload/ResolveApproval
	// against -- never hardcoded client-side, so a future seed-ID
	// change can't silently desync the two sides.
	WorkflowID string `json:"workflowID"`
	NodeID     string `json:"nodeID"`
	// SecretRequirements is every env-var-style secret placeholder this
	// block references (goal 0240 S2), each with its resolution source --
	// the Confirm screen's own design contract ("secrets it will need
	// with their resolution source: vault name / env var / you'll type
	// it"). Empty for a block that references none.
	SecretRequirements []SecretRequirementView `json:"secretRequirements"`
}

// SecretRequirementView is composition.SecretRequirement with JSON tags
// added -- same "adapter/service type stays free of a frontend-JSON
// concern living in the domain type" split every other *View/*Record
// shape in this codebase already follows (e.g. secretsvc.
// SecretAccessRecord).
type SecretRequirementView struct {
	VarName    string `json:"varName"`
	Source     string `json:"source"`
	VaultLabel string `json:"vaultLabel,omitempty"`
}

// CodeLoopService owns the coding loop's preview RPC and, since goal
// 0240 S2, the run-start entry point too: RunCommandBlock needs
// ExecutionService because it must stash any typed-at-Confirm secret
// VALUES (in memory, never persisted) BEFORE the run starts, atomically
// in one Go call -- doing that from the frontend as two separate RPCs
// would race against how quickly the guardrail gate lets the run
// proceed (RunCommandBlock's own doc comment has the full reasoning).
// Approve/cancel/result still reuse ExecutionService's existing
// ResolveApproval/GetRun/CancelRun directly from the frontend, unchanged
// from S1's own divergence statement -- only the run-START RPC moved.
type CodeLoopService struct {
	guard        *guardrailsvc.GuardrailService
	exec         *executionsvc.ExecutionService
	typedSecrets typedSecretsStore
}

// NewCodeLoopService constructs the service -- guard is read-only here
// (Rules()), never mutated. exec is wired late via SetExecutionService
// (main.go constructs codeLoopService before executionService: the same
// late-bound-setter shape TriggerService.SetExecutionService already
// uses, for the identical construction-order reason).
func NewCodeLoopService(guard *guardrailsvc.GuardrailService) *CodeLoopService {
	return &CodeLoopService{guard: guard, typedSecrets: newTypedSecretsStore()}
}

// SetExecutionService late-binds the run-start dependency -- see the
// struct's own doc comment. Exported for main.go wiring only, never a
// frontend RPC.
//
//wails:ignore
func (s *CodeLoopService) SetExecutionService(exec *executionsvc.ExecutionService) {
	s.exec = exec
}

// PreviewCommandBlock parses text and returns the Confirm screen's full
// preview. Returns an error only for an empty/whitespace-only block --
// every other shape (a placeholder-looking secret, a step the guardrail
// will ask about) is legitimate preview content, never a hard failure.
func (s *CodeLoopService) PreviewCommandBlock(text string) (CommandBlockPreview, error) {
	parsed := composition.ParseShellCommandBlock(text)
	if len(parsed) == 0 {
		return CommandBlockPreview{}, fmt.Errorf("nothing to run -- the clipboard has no command text")
	}

	commands := make([]string, len(parsed))
	for i, p := range parsed {
		commands[i] = p.Text
	}
	// Per-step verdicts (goal 0240 S3): the SAME per-line evaluation the
	// real execution gate uses (executionservice_guardrail.go's
	// evaluateVerdict), so Confirm and the actual run can never disagree
	// about which step an allow/deny-list pattern decided.
	stepVerdicts := s.guard.ShellCommandVerdicts(commands)

	steps := make([]CommandBlockPreviewStep, len(parsed))
	for i, p := range parsed {
		steps[i] = CommandBlockPreviewStep{
			Index: p.Index, Text: p.Text, Join: string(p.Join),
			LooksLikeSecretPlaceholder: p.LooksLikeSecretPlaceholder,
			Verdict:                    string(stepVerdicts[i].Effect),
			RuleLabel:                  stepVerdicts[i].RuleLabel,
		}
	}

	target := composition.ResolveShellCommandTarget()
	verdict := guardrail.WorstVerdict(stepVerdicts)

	names := composition.ExtractSecretEnvRefsAll(parsed)
	reqs := composition.ResolveSecretRequirements(names)
	secretReqs := make([]SecretRequirementView, len(reqs))
	for i, r := range reqs {
		secretReqs[i] = SecretRequirementView{VarName: r.VarName, Source: string(r.Source), VaultLabel: r.VaultLabel}
	}

	return CommandBlockPreview{
		Steps: steps, Shell: target.Shell, Dir: target.Dir,
		GuardrailVerdict:   string(verdict.Effect),
		WorkflowID:         composition.CodingLoopWorkflowID,
		NodeID:             composition.CodingLoopShellStepID,
		SecretRequirements: secretReqs,
	}, nil
}

// RunCommandBlock starts the coding loop's real run (goal 0240 S2,
// replacing the frontend's own direct RunWorkflowWithPayload call from
// S1): typedSecrets are the values the user typed at Confirm for
// whichever SecretRequirements above came back "prompt" -- stashed here
// under a fresh, single-use token BEFORE the run starts, so
// process-shell-command's own secret resolution (composition.
// shellSecretResolverFn, wired by wiring.WireCodingLoopSecrets) always
// finds them regardless of how quickly the guardrail gate lets the run
// through. This ordering is why RunCommandBlock exists as its own RPC
// rather than the frontend calling a separate "stash" RPC followed by
// ExecutionService.RunWorkflowWithPayload: two separate network round
// trips can't give this same atomicity guarantee, and getting it wrong
// would mean a fast/auto-approved run occasionally finding no stash at
// all. typedSecrets values themselves never appear in this call's own
// return value, in any log, or in workflowID/payload's own persisted
// run record -- only the opaque token does (composition.ExecContext.
// SecretsToken's own doc comment).
func (s *CodeLoopService) RunCommandBlock(workflowID, payload string, typedSecrets map[string]string) (executionsvc.RunSummary, error) {
	token := ""
	if len(typedSecrets) > 0 {
		token = s.typedSecrets.Stash(typedSecrets)
	}
	return s.exec.RunWorkflowWithSecretsToken(workflowID, executionsvc.RunKindTest, nil, payload, token)
}

// TakeTypedSecret pops varName's typed value out of token's stash --
// wiring.WireCodingLoopSecrets' own resolver seam calls this first, the
// SAME way it's the first source in the Confirm screen's own listed
// chain (vault -> env -> prompt is the DISPLAY order; a typed value, once
// it exists, always wins at resolution time since the user just
// confirmed it for THIS run). Exported for wiring only, never a frontend
// RPC.
//
//wails:ignore
func (s *CodeLoopService) TakeTypedSecret(token, varName string) (string, bool) {
	return s.typedSecrets.Take(token, varName)
}
