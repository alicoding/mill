package configuresvc

import (
	"fmt"
	"strings"
)

// refIntegrityError returns nil when no workflow references id under
// refKind, or an error naming every referencing workflow otherwise
// (docs/adr/0040 decision 3): a Configure entity delete is blocked
// while any workflow still needs it -- never a run-time-only dangling
// failure. entityNoun is the noun the error names the entity by
// ("request", "list", "MCP server", ...). compositionsvc owns the
// reverse lookup (WorkflowsReferencing) since it owns workflow data;
// this is the one call site every Delete* below shares rather than
// hand-copying the same two lines six times.
func (c *ConfigureService) refIntegrityError(refKind, entityNoun, id string) error {
	refs := c.composition.WorkflowsReferencing(refKind, id)
	if len(refs) == 0 {
		return nil
	}
	return fmt.Errorf("%s %q is still referenced by workflow(s) %s -- remove the reference before deleting it", entityNoun, id, strings.Join(refs, ", "))
}
