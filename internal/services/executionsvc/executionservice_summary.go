package executionsvc

import (
	"fmt"

	"github.com/alicoding/mill/internal/adapters/execution"
)

// summaryFor and summaryFromStatus turn a raw DBOS WorkflowStatus into
// Mill's own RunSummary shape -- split out of executionservice.go once
// that file crossed the 500-line limit (CLAUDE.md/§1.3), the same
// "split along a real seam" discipline executionservice_guardrail.go
// and executionchildworkflow.go already established for this package.
// This is a genuinely separable concern: decoding a DBOS status record,
// not starting/listing/redriving a run.

func (e *ExecutionService) summaryFor(runID string) (RunSummary, error) {
	statuses, err := execution.ListWorkflows(e.ctx, execution.WithFilterWorkflowIDs(runID))
	if err != nil {
		return RunSummary{}, fmt.Errorf("get run: %w", err)
	}
	if len(statuses) == 0 {
		return RunSummary{}, fmt.Errorf("no run with id %q", runID)
	}
	return e.summaryFromStatus(statuses[0]), nil
}

func (e *ExecutionService) summaryFromStatus(st execution.WorkflowStatus) RunSummary {
	in, _ := decodeAny[runInput](st.Input)
	label := in.WorkflowID
	if wf, ok := e.findWorkflow(in.WorkflowID); ok {
		label = wf.Label
	}
	errMsg := ""
	if st.Error != nil {
		errMsg = st.Error.Error()
	}
	output, _ := decodeAny[string](st.Output)
	kind := in.Kind
	if kind == "" {
		// Runs started before RunKind existed (or a future caller that
		// forgets to set it) default to "test" rather than an empty
		// string -- the safer of the two labels, since it excludes the
		// run from anything that ever starts treating "triggered" as a
		// production-traffic signal.
		kind = RunKindTest
	}
	// DBOS's own WorkflowStatus.StartedAt only gets populated when a
	// workflow is dequeued off a DBOS Queue (confirmed directly against
	// dbos-transact-golang's sysdb: started_at_epoch_ms is written solely
	// by DequeueWorkflows) -- Mill never enqueues a run onto a DBOS Queue
	// (RunWorkflow starts every run directly), so st.StartedAt is
	// unconditionally the zero value for every Mill run, which rendered
	// as the reported "1-12-31" bug on every resolved Review row.
	// st.CreatedAt (set once, at the initial INSERT, for every workflow
	// regardless of queueing) is the real fallback -- for Mill's own
	// synchronous start path it's effectively the same instant StartedAt
	// would have recorded anyway.
	startedAt := st.StartedAt
	if startedAt.IsZero() {
		startedAt = st.CreatedAt
	}
	summary := RunSummary{
		RunID:         st.ID,
		WorkflowID:    in.WorkflowID,
		WorkflowLabel: label,
		Status:        string(st.Status),
		Kind:          kind,
		Output:        output,
		StartedAt:     startedAt,
		CompletedAt:   st.CompletedAt,
		Error:         errMsg,
		Version:       in.Version,
		Values:        in.Values,
	}
	// Only a still-running run can be parked on an approval -- skip the
	// event poll for terminal runs (the common case in any list).
	if summary.Status == "PENDING" || summary.Status == "RUNNING" || summary.Status == "ENQUEUED" {
		summary.Pending = e.pendingApprovalFor(st.ID)
	} else {
		summary.Resolution = e.approvalResolutionFor(st.ID)
	}
	return summary
}
