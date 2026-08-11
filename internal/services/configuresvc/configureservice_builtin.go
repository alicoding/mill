package configuresvc

import (
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/domain/execenv"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/mcpserver"
	"github.com/alicoding/mill/internal/services/seeding"
)

// builtInSecrets holds the demo secret VALUES for httprequest.BuiltIn()'s
// seeded examples -- kept here, in the configure service package, not in
// internal/domain/httprequest, since HTTPRequest itself never carries a
// secret field (domain purity -- ADR-0007's own "the secret itself
// never lives on an HTTPRequest value at all" rule) -- only the layer
// that already owns c.credentials.Set calls should own these values too.
//
// Every value here is either a publicly-published test credential
// (Postman's own OAuth1 example, safe and intended to be shared) or an
// arbitrary placeholder string for an endpoint that doesn't actually
// validate the secret's value (httpbin.org's /headers, /get -- it just
// echoes back whatever it received, docs/SPEC.md §4's own honest
// caveat on those examples' Description). AuthOAuth2's example
// deliberately has no entry here -- Mill's own repo will never carry a
// real client secret, see httprequest.BuiltIn()'s own doc comment.
var builtInSecrets = map[string]string{
	httprequest.ExampleAPIKeyID:     "demo-api-key-do-not-use-in-production",
	httprequest.ExampleBearerID:     "demo-bearer-token-do-not-use-in-production",
	httprequest.ExampleHMACID:       "demo-hmac-signing-key-do-not-use-in-production",
	httprequest.ExampleQueryParamID: "demo-query-api-key-do-not-use-in-production",
}

// builtInOAuth1ConsumerSecret is Postman's own published, intentionally
// public test credential for postman-echo.com/oauth1 -- kept separate
// from builtInSecrets above since OAuth1 needs the dual-secret
// encoding (composition.EncodeOAuth1Secret, ADR-0015 §3), not a plain
// string. Independently confirmed live before being hardcoded here:
// running Mill's real OAuth1 strategy against postman-echo.com/oauth1
// with this exact credential returned {"status":"pass","message":
// "OAuth-1.0a signature verification was successful"} from the
// server's own side, not just self-consistent with Mill's own tests.
const builtInOAuth1ConsumerSecret = `D+EdQ-gs$-%@2Nu7`

// seedBuiltInSecrets writes each seeded example's demo secret into the
// OS keychain -- called only from ConfigureService.restore() on a
// genuinely fresh install (see restore()'s own comment for the lazy-
// seed-until-first-real-mutation reasoning, mirrored from
// CompositionService's identical pattern for Workflows). Best-effort,
// same as every other c.credentials.Set call site in this codebase: a
// keychain write can fail (headless/sandboxed CI, a locked keychain),
// and a failed *demo* secret write should degrade to "this one example
// needs the user to fill in their own secret," not crash startup.
func (c *ConfigureService) seedBuiltInSecrets() {
	for id, secret := range builtInSecrets {
		_ = c.credentials.Set(id, secret)
	}
	_ = c.credentials.Set(httprequest.ExampleOAuth1ID, composition.EncodeOAuth1Secret(builtInOAuth1ConsumerSecret, ""))
}

// topUpBuiltInRequests mirrors CompositionService.topUpBuiltIns for the
// seeded example HTTPRequests: any built-in whose ID is neither present
// nor tombstoned is appended (and its demo secret seeded), so a newly
// shipped example reaches existing instances too.
func (c *ConfigureService) topUpBuiltInRequests() {
	tombstones := seeding.LoadTombstones(c.store)
	c.mu.Lock()
	have := make(map[string]bool, len(c.requests))
	for _, r := range c.requests {
		have[r.ID] = true
	}
	var added []httprequest.HTTPRequest
	now := time.Now()
	for _, r := range httprequest.BuiltIn() {
		if !have[r.ID] && !tombstones[r.ID] {
			r.CreatedAt, r.UpdatedAt = now, now
			c.requests = append(c.requests, r)
			added = append(added, r)
		}
	}
	c.mu.Unlock()
	if len(added) == 0 {
		return
	}
	c.persistHTTPRequests()
	// Seed demo secrets only for the newly added examples -- never
	// re-Set an already-present example's secret, which the user may
	// have replaced with their own.
	for _, r := range added {
		if secret, ok := builtInSecrets[r.ID]; ok {
			_ = c.credentials.Set(r.ID, secret)
		}
		if r.ID == httprequest.ExampleOAuth1ID {
			_ = c.credentials.Set(r.ID, composition.EncodeOAuth1Secret(builtInOAuth1ConsumerSecret, ""))
		}
	}
}

// topUpBuiltInDecisions mirrors topUpBuiltInRequests for the seeded
// example Decisions (docs/adr/0027): any built-in whose ID is neither
// present nor tombstoned is appended, so a newly shipped example
// reaches existing instances too. Decisions carry no secret, so this
// is simpler than the HTTPRequest version -- no credential seeding
// step at all.
func (c *ConfigureService) topUpBuiltInDecisions() {
	tombstones := seeding.LoadTombstones(c.store)
	c.mu.Lock()
	have := make(map[string]bool, len(c.decisions))
	for _, d := range c.decisions {
		have[d.ID] = true
	}
	added := false
	now := time.Now()
	for _, d := range decision.BuiltIn() {
		if !have[d.ID] && !tombstones[d.ID] {
			d.CreatedAt, d.UpdatedAt = now, now
			c.decisions = append(c.decisions, d)
			added = true
		}
	}
	c.mu.Unlock()
	if added {
		c.persistDecisions()
	}
}

// topUpBuiltInLists mirrors topUpBuiltInDecisions for the seeded example
// Lists (docs/goals/0010 item 4): any built-in whose ID is neither
// present nor tombstoned is appended, so a newly shipped example
// reaches existing instances too. A List carries no secret, same
// "simpler than the HTTPRequest version" reasoning topUpBuiltInDecisions
// already gives.
func (c *ConfigureService) topUpBuiltInLists() {
	tombstones := seeding.LoadTombstones(c.store)
	c.mu.Lock()
	have := make(map[string]bool, len(c.lists))
	for _, l := range c.lists {
		have[l.ID] = true
	}
	added := false
	now := time.Now()
	for _, l := range list.BuiltIn() {
		if !have[l.ID] && !tombstones[l.ID] {
			l.CreatedAt, l.UpdatedAt = now, now
			c.lists = append(c.lists, l)
			added = true
		}
	}
	c.mu.Unlock()
	if added {
		c.persistLists()
	}
}

// topUpBuiltInMCPServers mirrors topUpBuiltInLists for the seeded
// example MCP Servers (docs/goals/0010 item 5): any built-in whose ID
// is neither present nor tombstoned is appended, so a newly shipped
// example reaches existing instances too.
func (c *ConfigureService) topUpBuiltInMCPServers() {
	tombstones := seeding.LoadTombstones(c.store)
	c.mu.Lock()
	have := make(map[string]bool, len(c.mcpServers))
	for _, s := range c.mcpServers {
		have[s.ID] = true
	}
	added := false
	now := time.Now()
	for _, s := range mcpserver.BuiltIn() {
		if !have[s.ID] && !tombstones[s.ID] {
			s.CreatedAt, s.UpdatedAt = now, now
			c.mcpServers = append(c.mcpServers, s)
			added = true
		}
	}
	c.mu.Unlock()
	if added {
		c.persistMCPServers()
	}
}

// topUpBuiltInExecEnvs mirrors topUpBuiltInMCPServers for the seeded
// example ExecEnv (docs/adr/0026, goal 0004b): any built-in whose ID is
// neither present nor tombstoned is appended, so a newly shipped
// example reaches existing instances too.
func (c *ConfigureService) topUpBuiltInExecEnvs() {
	tombstones := seeding.LoadTombstones(c.store)
	c.mu.Lock()
	have := make(map[string]bool, len(c.execEnvs))
	for _, e := range c.execEnvs {
		have[e.ID] = true
	}
	added := false
	now := time.Now()
	for _, e := range execenv.BuiltIn() {
		if !have[e.ID] && !tombstones[e.ID] {
			e.CreatedAt, e.UpdatedAt = now, now
			c.execEnvs = append(c.execEnvs, e)
			added = true
		}
	}
	c.mu.Unlock()
	if added {
		c.persistExecEnvs()
	}
}
