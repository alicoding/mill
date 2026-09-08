package configuresvc

import (
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/domain/reference"
)

// References answers "what currently references this Configure
// entity" from every source that can hold one (docs/goals/0392
// Decision 3): board objects (atlassvc, via boardRefs -- nil-safe, see
// its own field comment) and workflow nodes (compositionsvc's existing
// WorkflowsReferencing). The one combined index refIntegrityError below
// and Configure's own per-row usage indicator (configurelistusage.go)
// both read, so the two surfaces can never answer this differently.
func (c *ConfigureService) References(entityKind, id string) reference.Refs {
	var boards []reference.ObjectRef
	if c.boardRefs != nil {
		boards = c.boardRefs(entityKind, id)
	}
	return reference.Refs{Boards: boards, Workflows: c.composition.WorkflowsReferencing(entityKind, id)}
}

// refIntegrityError returns nil when nothing references id under
// refKind, or an error naming every referencing workflow AND board
// object otherwise (docs/adr/0040 decision 3, extended by docs/goals/
// 0392 Decision 3 to the Atlas half): a Configure entity delete is
// blocked while anything still needs it -- never a run-time-only
// dangling failure. entityNoun is the noun the error names the entity
// by ("request", "list", "MCP server", ...). This is the one call site
// every Delete* below shares rather than hand-copying the same check.
func (c *ConfigureService) refIntegrityError(refKind, entityNoun, id string) error {
	refs := c.References(refKind, id)
	if refs.Empty() {
		return nil
	}
	var by []string
	if len(refs.Workflows) > 0 {
		by = append(by, fmt.Sprintf("workflow(s) %s", strings.Join(refs.Workflows, ", ")))
	}
	if len(refs.Boards) > 0 {
		labels := make([]string, len(refs.Boards))
		for i, b := range refs.Boards {
			labels[i] = b.Label
		}
		by = append(by, fmt.Sprintf("board object(s) %s", strings.Join(labels, ", ")))
	}
	return fmt.Errorf("%s %q is still referenced by %s -- remove the reference before deleting it", entityNoun, id, strings.Join(by, " and "))
}
