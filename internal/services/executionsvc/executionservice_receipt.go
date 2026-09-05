package executionsvc

import (
	"fmt"

	"github.com/alicoding/mill/internal/adapters/buildinfo"
	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/contract"
	"github.com/alicoding/mill/internal/domain/composition"
)

// Registers composition.RunEvidence's shape with internal/contract at
// process start (ADR-0036 decision 1) -- the same "the envelope-owning
// package registers its own wire type" shape
// compositionservice_contract.go/configureservice_contract.go already
// establish for the other seven families; ExecutionService's own since
// it's the package that actually builds one (runEvidenceFor, below).
func init() {
	contract.Register("receipt", composition.RunEvidence{})
}

// SetVersion records the app version string (main.go's millVersion)
// this ExecutionService stamps into a run receipt's Build field --
// late-bound the same way SetMinutesSavedLookup/SetSystemEventSink are
// (executionservice.go), since ExecutionService is constructed before
// main.go would otherwise have a natural place to thread a version
// parameter through.
//
//wails:ignore
func (e *ExecutionService) SetVersion(version string) {
	e.version = version
}

// SetEnvironmentLabelLookup wires the Environment id -> label read a
// run summary and receipt need (goal 0306 S5) -- late-bound the same
// way SetVersion is, since ConfigureService is constructed after this
// service.
//
//wails:ignore
func (e *ExecutionService) SetEnvironmentLabelLookup(fn func(environmentID string) string) {
	e.environmentLabelLookup = fn
}

// runEvidenceLookup implements composition.SetRunEvidenceLookup: runCtx
// is only ever a real execution.Context in production (ADR-0008's
// single execution path) -- the same "resolve the opaque RunContext on
// THIS side of the seam" shape registerProcess
// (executionservice_cancel.go) already established, for the identical
// domain-purity reason (composition never imports execution.Context
// itself, .claude/rules/backend.md).
func (e *ExecutionService) runEvidenceLookup(runCtx any) (composition.RunEvidence, error) {
	ctx, ok := runCtx.(execution.Context)
	if !ok || ctx == nil {
		return composition.RunEvidence{}, fmt.Errorf("no durable run context available (a direct/test execution has no run identity to report on)")
	}
	runID, err := ctx.GetWorkflowID()
	if err != nil || runID == "" {
		return composition.RunEvidence{}, fmt.Errorf("resolve this run's id: %w", err)
	}
	return e.runEvidenceFor(runID)
}

// runEvidenceFor assembles runID's evidence-so-far (goal 0052 slice 3):
// GetRun's own real per-step breakdown -- the exact data the Runs tab
// renders, not a second read path -- filtered to steps this run has
// actually recorded. A step GetRun reports "pending" hasn't happened
// yet; requested mid-run (a process-run-receipt node executing), that
// means "still ahead of this node," never something to include in
// what's already happened.
func (e *ExecutionService) runEvidenceFor(runID string) (composition.RunEvidence, error) {
	detail, err := e.GetRun(runID)
	if err != nil {
		return composition.RunEvidence{}, err
	}

	steps := make([]composition.RunEvidenceStep, 0, len(detail.Steps))
	for _, s := range detail.Steps {
		if s.Status == "pending" {
			continue
		}
		var waits []composition.RunEvidenceWait
		for _, w := range s.Waits {
			waits = append(waits, composition.RunEvidenceWait{Parked: w.Reason, ParkedAt: w.ParkedAt, ResumedAt: w.ResumedAt})
		}
		steps = append(steps, composition.RunEvidenceStep{
			StepID: s.NodeID, StepTypeID: s.NodeTypeID, Status: s.Status,
			GuardrailEffect: s.GuardrailEffect, GuardrailRule: s.GuardrailRule, GuardrailSource: s.GuardrailSource,
			Waits: waits,
		})
	}

	build := buildinfo.Read()
	return composition.RunEvidence{
		Schema:           contract.SchemaID("receipt"),
		RunID:            detail.RunID,
		WorkflowID:       detail.WorkflowID,
		WorkflowLabel:    detail.WorkflowLabel,
		Version:          detail.Version,
		Kind:             string(detail.Kind),
		EnvironmentLabel: detail.EnvironmentLabel,
		StartedAt:        detail.StartedAt,
		Steps:            steps,
		Build: composition.RunEvidenceBuild{
			Version: e.version, Commit: build.Revision, Modified: build.Modified,
		},
	}, nil
}
