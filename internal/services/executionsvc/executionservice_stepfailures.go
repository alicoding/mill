package executionsvc

import (
	"fmt"
	"sort"

	"github.com/alicoding/mill/internal/adapters/execution"
)

// StepFailureBreakdown (docs/goals/0051 item 3, Power Automate's own
// "which connector fails most" class) -- a cross-workflow view Home's
// own aggregate query can't answer (HomeMetrics never fetches
// per-step data), so it lives on its own file/surface (the Activity
// page) rather than folded into executionservice_home.go.

// stepFailureScanLimit caps how many of the most recent runs this
// walks looking for failures -- the same "recent window, not an
// exhaustive historical report" scope ListRuns' own 50-run cap already
// established for Activity's cross-workflow feed, widened here since
// only a fraction of scanned runs are typically failures.
const stepFailureScanLimit = 200

// StepFailureCount is one step-type's failure tally across the most
// recently recorded runs -- derived by walking every failed run's
// checkpointed steps (via GetRun, reusing its own guardrail/cancelled-
// aware status classification rather than re-deriving it here) and
// joining each failed step's NodeID back to its current NodeTypeID/
// NodeTypeLabel. Falls back to the raw NodeID/StepName when the
// workflow's current definition no longer has that node (edited or
// deleted since the run), same "never blank out a row over missing
// display metadata" fallback GetRun itself already uses.
type StepFailureCount struct {
	NodeTypeID    string `json:"nodeTypeID"`
	NodeTypeLabel string `json:"nodeTypeLabel"`
	FailureCount  int    `json:"failureCount"`
}

// StepFailureBreakdown returns every step type that failed at least
// once across the most recent runs, most failures first.
func (e *ExecutionService) StepFailureBreakdown() ([]StepFailureCount, error) {
	statuses, err := execution.ListWorkflows(e.ctx,
		execution.WithFilterName(millRunWorkflowName),
		execution.WithFilterSortDesc(),
		execution.WithFilterLimit(stepFailureScanLimit),
	)
	if err != nil {
		return nil, fmt.Errorf("step failure breakdown: %w", err)
	}

	counts := map[string]*StepFailureCount{}
	var order []string
	for _, st := range statuses {
		if st.Status != "ERROR" && st.Status != "MAX_RECOVERY_ATTEMPTS_EXCEEDED" {
			continue // only a failed run can contain a failed step
		}
		detail, err := e.GetRun(st.ID)
		if err != nil {
			// Best-effort: one run whose steps can't be decoded shouldn't
			// blank out the whole breakdown.
			continue
		}
		for _, s := range detail.Steps {
			if s.Status != "failed" {
				continue
			}
			key := s.NodeTypeID
			if key == "" {
				key = s.NodeID
			}
			c, ok := counts[key]
			if !ok {
				label := s.NodeTypeLabel
				if label == "" {
					label = s.NodeID
				}
				c = &StepFailureCount{NodeTypeID: key, NodeTypeLabel: label}
				counts[key] = c
				order = append(order, key)
			}
			c.FailureCount++
		}
	}

	out := make([]StepFailureCount, 0, len(order))
	for _, k := range order {
		out = append(out, *counts[k])
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].FailureCount != out[j].FailureCount {
			return out[i].FailureCount > out[j].FailureCount
		}
		return out[i].NodeTypeLabel < out[j].NodeTypeLabel
	})
	return out, nil
}
