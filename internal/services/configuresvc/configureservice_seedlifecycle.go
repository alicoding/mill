package configuresvc

import (
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/domain/execenv"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/mcpserver"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/entitystore"
	"github.com/alicoding/mill/internal/services/seeding"
)

// Reset-to-shipped-example + restore-deleted-example RPCs
// (docs/goals/0037 items 4/5) for HTTPRequest/Decision -- split across
// this file and configureservice_seedlifecycle_more.go (List/
// MCPServer/ExecEnv) purely to stay under the 500-line convention; same
// per-concern organization every other configureservice_*.go file in
// this package already follows.

// SeedRevisions returns the CURRENTLY SHIPPED revision of every golden
// Configure entity (every type this service owns), keyed by its own
// ID -- IDs are unique across all five entity types (each domain
// package's own ExampleXID constants), so one flat map is enough,
// unlike seeding.AllSeedFingerprints' kind-namespaced keys (that one
// also needs to disambiguate an entity from a workflow sharing the
// same map; this map never mixes with CompositionService.SeedRevisions'
// own separate call). Lets the frontend's reset affordance render an
// accurate "Reset to shipped example vN" (docs/goals/0037 item 4).
func (c *ConfigureService) SeedRevisions() map[string]int {
	out := make(map[string]int)
	for _, r := range httprequest.BuiltIn() {
		out[r.ID] = r.Seed.SeedRevision
	}
	for _, d := range decision.BuiltIn() {
		out[d.ID] = d.Seed.SeedRevision
	}
	for _, l := range list.BuiltIn() {
		out[l.ID] = l.Seed.SeedRevision
	}
	for _, s := range mcpserver.BuiltIn() {
		out[s.ID] = s.Seed.SeedRevision
	}
	for _, e := range execenv.BuiltIn() {
		out[e.ID] = e.Seed.SeedRevision
	}
	for _, p := range aiprovider.BuiltIn() {
		out[p.ID] = p.Seed.SeedRevision
	}
	return out
}

// findGoldenRequest returns a copy of the golden HTTPRequest with id,
// if one exists among httprequest.BuiltIn().
func findGoldenRequest(id string) (httprequest.HTTPRequest, bool) {
	for _, g := range httprequest.BuiltIn() {
		if g.ID == id {
			return g, true
		}
	}
	return httprequest.HTTPRequest{}, false
}

// ResetHTTPRequestToSeed replaces id's content with the current
// golden's and clears the Modified latch (docs/goals/0037 item 4) --
// an explicit, on-demand act available regardless of current
// Modified/revision state, unlike reconcile's own conditional upgrade.
// Via httpRequestDescriptor (configureservice_builtin.go, goal 0165).
func (c *ConfigureService) ResetHTTPRequestToSeed(id string) (httprequest.HTTPRequest, error) {
	updated, err := entitystore.ResetToSeed(&c.mu, &c.requests, c.persistHTTPRequests, httpRequestDescriptor, id)
	if err != nil {
		return httprequest.HTTPRequest{}, err
	}
	dataevent.Emit("request", id) // goal 0017: live-sync every open surface
	return updated, nil
}

// RestorableHTTPRequests returns every built-in request the user
// deliberately deleted (tombstoned) and not since restored -- the read
// model for a "Restore example…" affordance, shown only when non-empty.
func (c *ConfigureService) RestorableHTTPRequests() []httprequest.HTTPRequest {
	return entitystore.Restorable(&c.mu, &c.requests, seeding.LoadTombstones(c.store), httpRequestDescriptor)
}

// RestoreHTTPRequest un-tombstones id and re-seeds it (docs/goals/0037
// item 5) -- the reverse of DeleteHTTPRequest for a built-in. Also
// re-seeds the demo secret, same as a fresh install's own
// seedBuiltInSecrets.
func (c *ConfigureService) RestoreHTTPRequest(id string) (httprequest.HTTPRequest, error) {
	restored, err := entitystore.Restore(&c.mu, &c.requests, c.persistHTTPRequests, c.store, httpRequestDescriptor, id)
	if err != nil {
		return httprequest.HTTPRequest{}, err
	}
	if secret, ok := builtInSecrets[restored.ID]; ok {
		_ = c.credentials.Set(restored.ID, secret)
	}
	dataevent.Emit("request", id) // goal 0017: live-sync every open surface
	return restored, nil
}

// ResetDecisionToSeed mirrors ResetHTTPRequestToSeed for Decisions,
// via decisionDescriptor (configuredecision.go, goal 0165).
func (c *ConfigureService) ResetDecisionToSeed(id string) (decision.Decision, error) {
	updated, err := entitystore.ResetToSeed(&c.mu, &c.decisions, c.persistDecisions, decisionDescriptor, id)
	if err != nil {
		return decision.Decision{}, err
	}
	dataevent.Emit("decision", id) // goal 0017: live-sync every open surface
	return updated, nil
}

// RestorableDecisions mirrors RestorableHTTPRequests for Decisions.
func (c *ConfigureService) RestorableDecisions() []decision.Decision {
	return entitystore.Restorable(&c.mu, &c.decisions, seeding.LoadTombstones(c.store), decisionDescriptor)
}

// RestoreDecision mirrors RestoreHTTPRequest for Decisions.
func (c *ConfigureService) RestoreDecision(id string) (decision.Decision, error) {
	restored, err := entitystore.Restore(&c.mu, &c.decisions, c.persistDecisions, c.store, decisionDescriptor, id)
	if err != nil {
		return decision.Decision{}, err
	}
	dataevent.Emit("decision", id) // goal 0017: live-sync every open surface
	return restored, nil
}
