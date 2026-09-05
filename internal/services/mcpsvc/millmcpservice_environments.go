package mcpsvc

import (
	"context"

	"github.com/alicoding/mill/internal/domain/environment"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// registerEnvironmentResources wires mill://environments beside the
// rest of the mill:// resources family (goal 0306 S5).
func (m *MillMCPService) registerEnvironmentResources() {
	m.server.AddResource(&mcp.Resource{
		URI: "mill://environments", Name: "environments", MIMEType: "application/json",
		Description: "Every environment's ID, Label, and variable names, each marked plain or secret. Values are never included: a secret variable's value is a reference into the secret store, and a plain one's belongs to the environment, not to this index.",
	}, m.readEnvironmentsIndex)
}

// readEnvironmentsIndex answers which stages exist and what each one
// can substitute -- enough for an agent to write {{VAR}} into a
// request and know it will resolve, with nothing crossing the boundary
// that a run would have to guard.
func (m *MillMCPService) readEnvironmentsIndex(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	return jsonContents(req.Params.URI, environmentIndex(m.cfg.Environments()))
}

// environmentIndex is the projection itself, separate from the
// transport so what does and does not cross the boundary is provable
// without a live session.
func environmentIndex(envs []environment.Environment) []environmentIndexEntry {
	out := make([]environmentIndexEntry, 0, len(envs))
	for _, e := range envs {
		vars := make([]environmentIndexVar, 0, len(e.Vars))
		for _, v := range e.Vars {
			vars = append(vars, environmentIndexVar{Key: v.Key, Secret: v.Secret, NeedsValue: v.Secret && v.Value == ""})
		}
		out = append(out, environmentIndexEntry{ID: e.ID, Label: e.Label, Variables: vars, SecretCount: environment.SecretCount(e)})
	}
	return out
}

// environmentIndexEntry is its own shape rather than
// resourceIndexEntry's: an environment's identifying fact is what it
// can substitute, which is a list, not a description.
type environmentIndexEntry struct {
	ID          string                `json:"id"`
	Label       string                `json:"label"`
	Variables   []environmentIndexVar `json:"variables"`
	SecretCount int                   `json:"secretCount"`
}

type environmentIndexVar struct {
	Key    string `json:"key"`
	Secret bool   `json:"secret"`
	// NeedsValue marks a secret variable with no store reference yet --
	// the one state that makes a run fail on a variable that otherwise
	// looks present.
	NeedsValue bool `json:"needsValue,omitempty"`
}
