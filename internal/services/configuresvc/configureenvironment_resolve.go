package configuresvc

import (
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/environment"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/vaultref"
)

// Everything about an Environment that reads the secret store or
// answers a question about a run (goal 0306 S5): resolution at send
// time, the pre-flight variable-gap check, the reference summary, and
// the variable set an execution environment borrows.

// resolveEnvironment implements composition's lookupEnvironmentFn seam.
// Unexported, so Wails never binds it -- Go-internal wiring only, same
// as resolveExecEnv/resolveHTTPRequest. A plain variable's value is its
// literal text; a secret variable's value is a store REFERENCE
// resolved here, through the same lenient path every other entity's
// secret-shaped field uses (vaultref.go), so a locked store surfaces
// as this call's own error rather than a silently empty variable.
func (c *ConfigureService) resolveEnvironment(id string, run composition.SecretAccessRun) (composition.ResolvedEnvironment, error) {
	found, ok := c.environmentByID(id)
	if !ok {
		return composition.ResolvedEnvironment{}, fmt.Errorf("no environment with id %q", id)
	}
	actx := secretaudit.AccessContext{Context: secretaudit.ContextEnvironmentVar, RunID: run.RunID, WorkflowID: run.WorkflowID}
	vars := make(map[string]string, len(found.Vars))
	for _, v := range found.Vars {
		if !v.Secret {
			vars[v.Key] = v.Value
			continue
		}
		value, err := c.resolveVaultRefValue(v.Value, actx)
		if err != nil {
			return composition.ResolvedEnvironment{}, fmt.Errorf("environment %q: resolving the secret for %s: %w", found.Label, v.Key, err)
		}
		vars[v.Key] = value
	}
	return composition.ResolvedEnvironment{ID: found.ID, Label: found.Label, Vars: vars}, nil
}

// environmentByID answers one Environment by id without holding the
// lock across anything else.
func (c *ConfigureService) environmentByID(id string) (environment.Environment, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, e := range c.environments {
		if e.ID == id {
			return e, true
		}
	}
	return environment.Environment{}, false
}

// EnvironmentLabel answers one environment's label, or "" -- the run
// summary and receipt name the environment a run used, and neither
// should have to fetch the whole entity for one word.
//
//wails:ignore
func (c *ConfigureService) EnvironmentLabel(id string) string {
	e, ok := c.environmentByID(id)
	if !ok {
		return ""
	}
	return e.Label
}

// environmentVarGap implements composition's environmentVarGapFn seam:
// which {{var}} names this request carries that the chosen environment
// cannot resolve. Reads the STORED request rather than a resolved one
// -- pre-flight runs before anyone approved anything, so it must not
// open the secret store to answer a question about text.
func (c *ConfigureService) environmentVarGap(requestID, environmentID string) []string {
	var found *httprequest.HTTPRequest
	for _, r := range c.HTTPRequests() {
		if r.ID == requestID {
			rr := r
			found = &rr
			break
		}
	}
	if found == nil {
		return nil // an unknown request is validateRequiredRefs' territory
	}
	refs := composition.RequestVarRefs(composition.ResolvedHTTPRequest{
		BaseURL: found.BaseURL, Body: found.Body, Headers: found.Headers, Auth: found.Auth,
	})
	if len(refs) == 0 {
		return nil
	}
	keys := map[string]bool{}
	if strings.TrimSpace(environmentID) != "" {
		if env, ok := c.environmentByID(environmentID); ok {
			for _, v := range env.Vars {
				keys[v.Key] = true
			}
		}
	}
	var missing []string
	for _, key := range refs {
		if !keys[key] {
			missing = append(missing, key)
		}
	}
	return missing
}

// environmentEnvEntries materializes one Environment's variables as
// the KEY=VALUE entries an execution environment prepends to its own
// (goal 0306 S5's base-plus-override merge). Secret variables are
// resolved through the same audited path resolveEnvironment uses.
func (c *ConfigureService) environmentEnvEntries(id string, run composition.SecretAccessRun) ([]string, error) {
	env, err := c.resolveEnvironment(id, run)
	if err != nil {
		return nil, err
	}
	found, _ := c.environmentByID(id)
	out := make([]string, 0, len(found.Vars))
	// Ordered by the environment's own variable order, not the resolved
	// map's: a shell's inherited variables should read the way they
	// were authored.
	for _, v := range found.Vars {
		out = append(out, v.Key+"="+env.Vars[v.Key])
	}
	return out, nil
}

// describeEnvironment is the reference peek's answer for an
// environment (goal 0312): what it holds, and what is not usable yet.
// A secret variable's VALUE is never a line -- the reference's own
// title is, which is the whole point of storing a pointer.
func (c *ConfigureService) describeEnvironment(out *ReferenceSummary) bool {
	env, ok := c.environmentByID(out.ID)
	if !ok {
		return false
	}
	out.Label = env.Label
	titles := c.secretTitlesByID()
	for _, v := range env.Vars {
		out.Lines = append(out.Lines, SummaryLine{Label: v.Key, Value: c.environmentVarDisplay(v, titles)})
		if !v.Secret {
			continue
		}
		if strings.TrimSpace(v.Value) == "" {
			out.Problems = append(out.Problems, "Variable "+v.Key+" needs a value.")
			continue
		}
		if problem := c.vaultRefProblem("Variable "+v.Key, v.Value); problem != "" {
			out.Problems = append(out.Problems, problem)
		}
	}
	return true
}

// environmentVarDisplay is the one place a variable turns into
// readable text: a plain variable shows its literal, a secret one
// shows the store entry it points at, and a secret with no reference
// yet says so.
func (c *ConfigureService) environmentVarDisplay(v environment.Variable, titles map[string]string) string {
	if !v.Secret {
		return v.Value
	}
	if strings.TrimSpace(v.Value) == "" {
		return needsAValue
	}
	id, ok := vaultref.Parse(v.Value)
	if !ok {
		return unknownVaultLabel
	}
	if title := titles[id]; title != "" {
		return title
	}
	return unknownVaultLabel
}

// needsAValue is the one wording for a secret-shaped field that has no
// reference yet -- used by the reference peek and the MCP index alike,
// so an agent and a person read the same status.
const needsAValue = "Needs a value"

// secretTitlesByID snapshots the store's titles once per describe
// call. A store that cannot be listed (locked, not wired yet) yields
// no titles rather than an error: a description must still answer.
func (c *ConfigureService) secretTitlesByID() map[string]string {
	titles := map[string]string{}
	summaries, err := c.secretLabelsLister()
	if err != nil {
		return titles
	}
	for _, s := range summaries {
		titles[s.ID] = s.Title
	}
	return titles
}
