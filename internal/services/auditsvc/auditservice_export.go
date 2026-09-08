package auditsvc

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/adapters/auditstore"
	"github.com/alicoding/mill/internal/domain/audit"
)

// exportPageSize is how many rows one List call fetches while paging
// the whole trail for export -- large enough that a full 10,000-row
// retention window exports in a handful of round trips, never one row
// at a time.
const exportPageSize = 500

// exportRow is the export's own JSON shape -- audit.Entry itself is a
// pure domain type with no JSON tags (.claude/rules/backend.md's
// "adapter type stays free of a frontend-JSON concern" convention, the
// same reasoning MCPCallRecord/SecretAccessRecord already follow).
// Every field but the required ones is omitted when empty rather than
// serialized as "", so a kind that never populates Actor.AgentSession
// (say) doesn't pad every line.
type exportRow struct {
	ID           int64             `json:"id"`
	Timestamp    string            `json:"timestamp"`
	Kind         string            `json:"kind"`
	RunID        string            `json:"runId,omitempty"`
	WorkflowID   string            `json:"workflowId,omitempty"`
	StepID       string            `json:"stepId,omitempty"`
	AgentSession string            `json:"agentSession,omitempty"`
	Source       string            `json:"source,omitempty"`
	Action       string            `json:"action"`
	TargetKind   string            `json:"targetKind,omitempty"`
	TargetID     string            `json:"targetId,omitempty"`
	TargetLabel  string            `json:"targetLabel,omitempty"`
	Outcome      string            `json:"outcome"`
	FailureKind  string            `json:"failureKind,omitempty"`
	Attributes   map[string]string `json:"attributes,omitempty"`
}

func toExportRow(e audit.Entry) exportRow {
	return exportRow{
		ID: e.ID, Timestamp: e.Timestamp.Format("2006-01-02T15:04:05.000Z07:00"), Kind: string(e.Kind),
		RunID: e.Actor.RunID, WorkflowID: e.Actor.WorkflowID, StepID: e.Actor.StepID,
		AgentSession: e.Actor.AgentSession, Source: e.Actor.Source,
		Action: e.Action, TargetKind: e.Target.Kind, TargetID: e.Target.ID, TargetLabel: e.Target.Label,
		Outcome: e.Outcome, FailureKind: e.FailureKind, Attributes: e.Attributes,
	}
}

// ExportAuditTrail returns every audit_entries row matching kinds
// (empty means every kind) as JSON lines -- one exportRow object per
// line, oldest matches of each page first -- goal 0351 Decision 5's
// "one export door, filtered by kind": the same shared reader backs
// both this general export and (unchanged since it already reads
// through this same table) PluginService.ExportPluginAudit's own
// plugin-secret-access slice.
func (s *AuditService) ExportAuditTrail(kinds []string) (string, error) {
	filterKinds := make([]audit.Kind, 0, len(kinds))
	for _, k := range kinds {
		if k != "" {
			filterKinds = append(filterKinds, audit.Kind(k))
		}
	}

	var out strings.Builder
	cursor := int64(0)
	for {
		page, err := s.store.List(context.Background(), auditstore.Filter{Kinds: filterKinds, Limit: exportPageSize, Cursor: cursor})
		if err != nil {
			return "", fmt.Errorf("auditsvc: export: %w", err)
		}
		for _, e := range page.Entries {
			line, err := json.Marshal(toExportRow(e))
			if err != nil {
				return "", fmt.Errorf("auditsvc: export: marshal: %w", err)
			}
			out.Write(line)
			out.WriteByte('\n')
		}
		if !page.HasMore {
			break
		}
		cursor = page.NextCursor
	}
	return out.String(), nil
}
