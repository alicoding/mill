package composition

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// RunEvidence is the current run's evidence-so-far (goal 0052 slice 3,
// ADR-0036): the JSON shape process-run-receipt marshals into the
// payload. Registered with internal/contract as the "receipt" family
// from executionsvc's own init() -- the package that actually builds
// one (runEvidenceFor), the same "the envelope-owning package registers
// its own wire type" shape compositionservice_contract.go/
// configureservice_contract.go already establish for the other seven
// families. Steps only ever covers what ran BEFORE this node -- a run's
// own graph continues past it, so this is honestly the receipt "so
// far," never the whole run.
type RunEvidence struct {
	Schema        string `json:"schema"`
	RunID         string `json:"runId"`
	WorkflowID    string `json:"workflowId"`
	WorkflowLabel string `json:"workflowLabel,omitempty"`
	// Version is the run's own definition-snapshot version (docs/adr/0021)
	// -- 0 means the draft head (a test run).
	Version   int       `json:"version"`
	Kind      string    `json:"kind"`
	StartedAt time.Time `json:"startedAt"`
	// Steps is every step this run recorded before this receipt node
	// ran. A step's GuardrailEffect/GuardrailRule/GuardrailSource ARE
	// its approval resolution where one applies -- a step that reached
	// here with effect "ask" was already approved (a deny fails the run
	// before this node could ever execute), so there's no separate
	// approvals list to keep in sync with this one.
	Steps []RunEvidenceStep `json:"steps"`
	Build RunEvidenceBuild  `json:"build"`
}

// RunEvidenceStep is one already-executed step's recorded outcome,
// narrowed from executionsvc's own RunStep to what a portable receipt
// needs (never the full Input/Output payload bodies -- those are the
// run's own business data, not the receipt's job to duplicate). Field
// names are step-vocabulary outright, no legacy alias (docs/goals/0053
// tier 2): this envelope was born after the vocabulary decision, so
// there is no prior export to stay compatible with.
type RunEvidenceStep struct {
	StepID          string `json:"stepId"`
	StepTypeID      string `json:"stepTypeId"`
	Status          string `json:"status"`
	GuardrailEffect string `json:"guardrailEffect,omitempty"`
	GuardrailRule   string `json:"guardrailRule,omitempty"`
	GuardrailSource string `json:"guardrailSource,omitempty"`
}

// RunEvidenceBuild is which Mill build actually produced this receipt.
// Legitimate per-run build info even though ADR-0036 decision 4
// forbids stamping build info into an ENTITY export: an entity export
// is byte-identical-when-unchanged by design (a git-diffable artifact
// that would otherwise churn on every app upgrade), a run receipt is a
// one-shot snapshot of one run and has no such property to protect.
type RunEvidenceBuild struct {
	Version  string `json:"version"`
	Commit   string `json:"commit,omitempty"`
	Modified bool   `json:"modified"`
}

// lookupRunEvidenceFn defaults to erroring so a process-run-receipt
// node run before ExecutionService exists (or before
// SetRunEvidenceLookup wires it) fails loudly instead of silently
// no-op'ing -- same pattern as every other lookup*Fn in this package.
// Takes the opaque ExecContext.RunContext, not a plain runID:
// composition itself never type-asserts it into a real
// execution.Context (domain purity, .claude/rules/backend.md) -- the
// runID is resolved on the OTHER side of this seam, inside executionsvc,
// the same shape SetProcessRegistrar/registerRunningProcessFn
// (codeexec.go) already established for the identical reason.
var lookupRunEvidenceFn = func(_ any) (RunEvidence, error) {
	return RunEvidence{}, fmt.Errorf("no run-evidence lookup registered (yet)")
}

// SetRunEvidenceLookup wires the function process-run-receipt nodes use
// to resolve the CURRENT run's own recorded evidence. Called once from
// main.go once ExecutionService exists.
func SetRunEvidenceLookup(fn func(runCtx any) (RunEvidence, error)) {
	lookupRunEvidenceFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "process-run-receipt", Kind: KindProcess,
		Effect:      guardrail.ClassRead,
		Complexity:  ComplexityBasic,
		Consumes:    []PayloadKind{PayloadNone},
		Produces:    PayloadProduce{Kind: PayloadJSON},
		Output:      "a JSON receipt of this run's steps so far",
		Label:       "Create run receipt",
		Description: "Renders this run's own recorded evidence (its steps so far, their guardrail verdicts, and which Mill build ran them) as a JSON receipt, replacing the payload. Only covers steps that ran BEFORE this one, since the run is still in flight when this step executes. Compose it with an Apply step (clipboard/file write) to hand the receipt to an external agent; there is no separate send path.",
	}, func(_ Node, ctx ExecContext) (ExecContext, error) {
		evidence, err := lookupRunEvidenceFn(ctx.RunContext)
		if err != nil {
			return ctx, fmt.Errorf("process-run-receipt: %w", err)
		}
		data, err := json.MarshalIndent(evidence, "", "  ")
		if err != nil {
			return ctx, fmt.Errorf("process-run-receipt: %w", err)
		}
		ctx.Payload = string(data)
		return ctx, nil
	})
}
