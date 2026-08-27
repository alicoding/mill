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
}

// CommandBlockPreview is PreviewCommandBlock's full return shape.
type CommandBlockPreview struct {
	Steps []CommandBlockPreviewStep `json:"steps"`
	Shell string                    `json:"shell"`
	Dir   string                    `json:"dir"`
	// GuardrailVerdict is "allow" | "ask" | "deny" -- one verdict for
	// the whole block, since S1's guardrail plane evaluates per NODE,
	// not per parsed line (every step shares the seed's own single
	// process-shell-command node). A future allow/deny pattern-list
	// slice (goal 0240 S3) is what would ever make per-step verdicts
	// differ; nothing in this preview's own shape needs to change for
	// that to land.
	GuardrailVerdict string `json:"guardrailVerdict"`
	// WorkflowID/NodeID name which real seeded workflow/node the
	// frontend will call RunWorkflowWithPayload/ResolveApproval
	// against -- never hardcoded client-side, so a future seed-ID
	// change can't silently desync the two sides.
	WorkflowID string `json:"workflowID"`
	NodeID     string `json:"nodeID"`
}

// CodeLoopService owns the coding loop's preview RPC only -- the actual
// run/approve/cancel/result path reuses ExecutionService's existing
// RunWorkflowWithPayload/ResolveApproval/GetRun/CancelRun directly (no
// bespoke exec path, docs/goals/0240 S1's own divergence statement),
// which is why this service has no dependency on ExecutionService at
// all.
type CodeLoopService struct {
	guard *guardrailsvc.GuardrailService
}

// NewCodeLoopService constructs the service -- guard is read-only here
// (Rules()), never mutated.
func NewCodeLoopService(guard *guardrailsvc.GuardrailService) *CodeLoopService {
	return &CodeLoopService{guard: guard}
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

	steps := make([]CommandBlockPreviewStep, len(parsed))
	for i, p := range parsed {
		steps[i] = CommandBlockPreviewStep{
			Index: p.Index, Text: p.Text, Join: string(p.Join),
			LooksLikeSecretPlaceholder: p.LooksLikeSecretPlaceholder,
		}
	}

	target := composition.ResolveShellCommandTarget()
	verdict := guardrail.Evaluate(s.guard.Rules(), guardrail.Step{
		WorkflowID: composition.CodingLoopWorkflowID,
		NodeID:     composition.CodingLoopShellStepID,
		NodeTypeID: "process-shell-command",
	}, guardrail.ClassExternal)

	return CommandBlockPreview{
		Steps: steps, Shell: target.Shell, Dir: target.Dir,
		GuardrailVerdict: string(verdict.Effect),
		WorkflowID:       composition.CodingLoopWorkflowID,
		NodeID:           composition.CodingLoopShellStepID,
	}, nil
}
