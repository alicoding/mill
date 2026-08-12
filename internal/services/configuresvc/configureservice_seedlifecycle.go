package configuresvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/domain/execenv"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/mcpserver"
	"github.com/alicoding/mill/internal/services/dataevent"
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
func (c *ConfigureService) ResetHTTPRequestToSeed(id string) (httprequest.HTTPRequest, error) {
	golden, ok := findGoldenRequest(id)
	if !ok {
		return httprequest.HTTPRequest{}, fmt.Errorf("no built-in request with id %q", id)
	}
	c.mu.Lock()
	idx := -1
	for i, r := range c.requests {
		if r.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return httprequest.HTTPRequest{}, fmt.Errorf("no request with id %q", id)
	}
	previous := c.requests[idx]
	updated := upgradeRequestToGolden(previous, golden, time.Now())
	c.requests[idx] = updated
	c.mu.Unlock()

	if err := c.persistHTTPRequests(); err != nil {
		c.mu.Lock()
		c.requests[idx] = previous
		c.mu.Unlock()
		return httprequest.HTTPRequest{}, fmt.Errorf("save reset request: %w", err)
	}
	dataevent.Emit("request", id) // goal 0017: live-sync every open surface
	return updated, nil
}

// RestorableHTTPRequests returns every built-in request the user
// deliberately deleted (tombstoned) and not since restored -- the read
// model for a "Restore example…" affordance, shown only when non-empty.
func (c *ConfigureService) RestorableHTTPRequests() []httprequest.HTTPRequest {
	tombstones := seeding.LoadTombstones(c.store)
	if len(tombstones) == 0 {
		return nil
	}
	c.mu.Lock()
	have := make(map[string]bool, len(c.requests))
	for _, r := range c.requests {
		have[r.ID] = true
	}
	c.mu.Unlock()
	var out []httprequest.HTTPRequest
	for _, golden := range httprequest.BuiltIn() {
		if tombstones[golden.ID] && !have[golden.ID] {
			out = append(out, golden)
		}
	}
	return out
}

// RestoreHTTPRequest un-tombstones id and re-seeds it (docs/goals/0037
// item 5) -- the reverse of DeleteHTTPRequest for a built-in. Also
// re-seeds the demo secret, same as a fresh install's own
// seedBuiltInSecrets.
func (c *ConfigureService) RestoreHTTPRequest(id string) (httprequest.HTTPRequest, error) {
	golden, ok := findGoldenRequest(id)
	if !ok {
		return httprequest.HTTPRequest{}, fmt.Errorf("no built-in request with id %q", id)
	}
	c.mu.Lock()
	for _, existing := range c.requests {
		if existing.ID == id {
			c.mu.Unlock()
			return httprequest.HTTPRequest{}, fmt.Errorf("request %q is already present, nothing to restore", id)
		}
	}
	c.mu.Unlock()

	if err := seeding.ClearTombstone(c.store, id); err != nil {
		return httprequest.HTTPRequest{}, fmt.Errorf("clear tombstone for %q: %w", id, err)
	}
	now := time.Now()
	golden.CreatedAt, golden.UpdatedAt = now, now

	c.mu.Lock()
	c.requests = append(c.requests, golden)
	c.mu.Unlock()

	if err := c.persistHTTPRequests(); err != nil {
		c.mu.Lock()
		for i, r := range c.requests {
			if r.ID == id {
				c.requests = append(c.requests[:i], c.requests[i+1:]...)
				break
			}
		}
		c.mu.Unlock()
		return httprequest.HTTPRequest{}, fmt.Errorf("save restored request: %w", err)
	}
	if secret, ok := builtInSecrets[golden.ID]; ok {
		_ = c.credentials.Set(golden.ID, secret)
	}
	dataevent.Emit("request", id) // goal 0017: live-sync every open surface
	return golden, nil
}

// findGoldenDecision returns a copy of the golden Decision with id, if
// one exists among decision.BuiltIn().
func findGoldenDecision(id string) (decision.Decision, bool) {
	for _, g := range decision.BuiltIn() {
		if g.ID == id {
			return g, true
		}
	}
	return decision.Decision{}, false
}

// ResetDecisionToSeed mirrors ResetHTTPRequestToSeed for Decisions.
func (c *ConfigureService) ResetDecisionToSeed(id string) (decision.Decision, error) {
	golden, ok := findGoldenDecision(id)
	if !ok {
		return decision.Decision{}, fmt.Errorf("no built-in decision with id %q", id)
	}
	c.mu.Lock()
	idx := -1
	for i, d := range c.decisions {
		if d.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return decision.Decision{}, fmt.Errorf("no decision with id %q", id)
	}
	previous := c.decisions[idx]
	updated := upgradeDecisionToGolden(previous, golden, time.Now())
	c.decisions[idx] = updated
	c.mu.Unlock()

	if err := c.persistDecisions(); err != nil {
		c.mu.Lock()
		c.decisions[idx] = previous
		c.mu.Unlock()
		return decision.Decision{}, fmt.Errorf("save reset decision: %w", err)
	}
	dataevent.Emit("decision", id) // goal 0017: live-sync every open surface
	return updated, nil
}

// RestorableDecisions mirrors RestorableHTTPRequests for Decisions.
func (c *ConfigureService) RestorableDecisions() []decision.Decision {
	tombstones := seeding.LoadTombstones(c.store)
	if len(tombstones) == 0 {
		return nil
	}
	c.mu.Lock()
	have := make(map[string]bool, len(c.decisions))
	for _, d := range c.decisions {
		have[d.ID] = true
	}
	c.mu.Unlock()
	var out []decision.Decision
	for _, golden := range decision.BuiltIn() {
		if tombstones[golden.ID] && !have[golden.ID] {
			out = append(out, golden)
		}
	}
	return out
}

// RestoreDecision mirrors RestoreHTTPRequest for Decisions.
func (c *ConfigureService) RestoreDecision(id string) (decision.Decision, error) {
	golden, ok := findGoldenDecision(id)
	if !ok {
		return decision.Decision{}, fmt.Errorf("no built-in decision with id %q", id)
	}
	c.mu.Lock()
	for _, existing := range c.decisions {
		if existing.ID == id {
			c.mu.Unlock()
			return decision.Decision{}, fmt.Errorf("decision %q is already present, nothing to restore", id)
		}
	}
	c.mu.Unlock()

	if err := seeding.ClearTombstone(c.store, id); err != nil {
		return decision.Decision{}, fmt.Errorf("clear tombstone for %q: %w", id, err)
	}
	now := time.Now()
	golden.CreatedAt, golden.UpdatedAt = now, now

	c.mu.Lock()
	c.decisions = append(c.decisions, golden)
	c.mu.Unlock()

	if err := c.persistDecisions(); err != nil {
		c.mu.Lock()
		for i, d := range c.decisions {
			if d.ID == id {
				c.decisions = append(c.decisions[:i], c.decisions[i+1:]...)
				break
			}
		}
		c.mu.Unlock()
		return decision.Decision{}, fmt.Errorf("save restored decision: %w", err)
	}
	dataevent.Emit("decision", id) // goal 0017: live-sync every open surface
	return golden, nil
}
