package configuresvc

import (
	"log/slog"
	"time"

	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/services/entitystore"
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
const builtInOAuth1ConsumerSecret = `D+EdQ-gs$-%@2Nu7` //nolint:gosec // Postman's own published, intentionally public test credential -- not a real secret (see doc comment above)

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

// reconcileBuiltInRequests replaces the old insert-only
// topUpBuiltInRequests with the full insert/upgrade/leave-alone/skip
// algorithm (docs/goals/0037 -- see compositionsvc's
// reconcileBuiltIns, the identical algorithm applied to Workflows, for
// the full reasoning). Unlike Workflows, an HTTPRequest carries no
// version history -- "upgrade" replaces its content in place rather
// than publishing a new version. An existing entry whose ID matches a
// golden but carries no SeedOrigin (SeedRevision == 0 -- predates this
// goal) is migration-stamped Modified: true rather than silently
// upgraded.
func (c *ConfigureService) reconcileBuiltInRequests() {
	tombstones := seeding.LoadTombstones(c.store)
	now := time.Now()
	c.mu.Lock()
	byID := make(map[string]int, len(c.requests))
	for i, r := range c.requests {
		byID[r.ID] = i
	}
	changed := false
	var seededSecretsFor []httprequest.HTTPRequest
	for _, golden := range httprequest.BuiltIn() {
		idx, present := byID[golden.ID]
		if !present {
			if tombstones[golden.ID] {
				continue
			}
			golden.CreatedAt, golden.UpdatedAt = now, now
			c.requests = append(c.requests, golden)
			seededSecretsFor = append(seededSecretsFor, golden)
			changed = true
			continue
		}
		existing := c.requests[idx]
		if existing.Seed.SeedRevision == 0 {
			existing.Seed = seedorigin.Origin{SeedRevision: golden.Seed.SeedRevision, Modified: true}
			c.requests[idx] = existing
			changed = true
			continue
		}
		if existing.Seed.Modified {
			continue
		}
		if existing.Seed.SeedRevision < golden.Seed.SeedRevision {
			c.requests[idx] = upgradeRequestToGolden(existing, golden, now)
			changed = true
		}
	}
	c.mu.Unlock()
	if !changed {
		return
	}
	// Startup reconciliation, not a user-initiated RPC -- log-only, same
	// fire-and-forget treatment the old top-up functions already used
	// (docs/goals/0025 item 1).
	if err := c.persistHTTPRequests(); err != nil {
		slog.Error("failed to reconcile built-in HTTPRequests", "error", err)
	}
	// Seed demo secrets only for newly-inserted examples -- never
	// re-Set an already-present example's secret, which the user may
	// have replaced with their own.
	for _, r := range seededSecretsFor {
		if secret, ok := builtInSecrets[r.ID]; ok {
			_ = c.credentials.Set(r.ID, secret)
		}
		if r.ID == httprequest.ExampleOAuth1ID {
			_ = c.credentials.Set(r.ID, composition.EncodeOAuth1Secret(builtInOAuth1ConsumerSecret, ""))
		}
	}
}

// upgradeRequestToGolden replaces existing's content with golden's,
// preserving existing's identity (ID/CreatedAt) -- shared by
// reconcile's upgrade branch and ResetHTTPRequestToSeed
// (configureservice_seedlifecycle.go).
func upgradeRequestToGolden(existing, golden httprequest.HTTPRequest, now time.Time) httprequest.HTTPRequest {
	golden.CreatedAt = existing.CreatedAt
	golden.UpdatedAt = now
	golden.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
	return golden
}

// reconcileBuiltInDecisions mirrors reconcileBuiltInRequests for the
// seeded example Decisions (docs/adr/0027) via decisionDescriptor
// (configuredecision.go, goal 0165). Decisions carry no secret, so
// this is simpler than the HTTPRequest version -- no credential
// seeding step at all.
func (c *ConfigureService) reconcileBuiltInDecisions() {
	tombstones := seeding.LoadTombstones(c.store)
	if _, changed := entitystore.Reconcile(&c.mu, &c.decisions, tombstones, decisionDescriptor); changed {
		if err := c.persistDecisions(); err != nil {
			slog.Error("failed to reconcile built-in Decisions", "error", err)
		}
	}
}

// reconcileBuiltInLists mirrors reconcileBuiltInDecisions for the
// seeded example Lists (docs/goals/0010 item 4). A List carries no
// secret, same "simpler than the HTTPRequest version" reasoning
// reconcileBuiltInDecisions already gives.
func (c *ConfigureService) reconcileBuiltInLists() {
	tombstones := seeding.LoadTombstones(c.store)
	now := time.Now()
	c.mu.Lock()
	byID := make(map[string]int, len(c.lists))
	for i, l := range c.lists {
		byID[l.ID] = i
	}
	changed := false
	for _, golden := range list.BuiltIn() {
		idx, present := byID[golden.ID]
		if !present {
			if tombstones[golden.ID] {
				continue
			}
			golden.CreatedAt, golden.UpdatedAt = now, now
			c.lists = append(c.lists, golden)
			changed = true
			continue
		}
		existing := c.lists[idx]
		if existing.Seed.SeedRevision == 0 {
			existing.Seed = seedorigin.Origin{SeedRevision: golden.Seed.SeedRevision, Modified: true}
			c.lists[idx] = existing
			changed = true
			continue
		}
		if existing.Seed.Modified {
			continue
		}
		if existing.Seed.SeedRevision < golden.Seed.SeedRevision {
			c.lists[idx] = upgradeListToGolden(existing, golden, now)
			changed = true
		}
	}
	c.mu.Unlock()
	if changed {
		if err := c.persistLists(); err != nil {
			slog.Error("failed to reconcile built-in Lists", "error", err)
		}
	}
}

// upgradeListToGolden replaces existing's content -- including Rows --
// with golden's. golden's Row IDs are stable literals (list.BuiltIn's
// own activeRow/expiredRow helpers), so this is safe to replace
// wholesale rather than row-by-row diffing.
func upgradeListToGolden(existing, golden list.List, now time.Time) list.List {
	golden.CreatedAt = existing.CreatedAt
	golden.UpdatedAt = now
	golden.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
	return golden
}

// reconcileBuiltInMCPServers mirrors reconcileBuiltInLists for the
// seeded example MCP Servers (docs/goals/0010 item 5) via
// mcpServerDescriptor (configuremcpserver.go, goal 0165).
func (c *ConfigureService) reconcileBuiltInMCPServers() {
	tombstones := seeding.LoadTombstones(c.store)
	if _, changed := entitystore.Reconcile(&c.mu, &c.mcpServers, tombstones, mcpServerDescriptor); changed {
		if err := c.persistMCPServers(); err != nil {
			slog.Error("failed to reconcile built-in MCP Servers", "error", err)
		}
	}
}

// reconcileBuiltInExecEnvs mirrors reconcileBuiltInMCPServers for the
// seeded example ExecEnv (docs/adr/0026, goal 0004b) via
// execEnvDescriptor (configureexecenv.go, goal 0165).
func (c *ConfigureService) reconcileBuiltInExecEnvs() {
	tombstones := seeding.LoadTombstones(c.store)
	if _, changed := entitystore.Reconcile(&c.mu, &c.execEnvs, tombstones, execEnvDescriptor); changed {
		if err := c.persistExecEnvs(); err != nil {
			slog.Error("failed to reconcile built-in ExecEnvs", "error", err)
		}
	}
}

// reconcileBuiltInAIProviders mirrors reconcileBuiltInMCPServers for the
// seeded example AI provider (docs/goals/0031-ai-node-family.md). No
// credential seeding step: the seeded "Local Ollama" example needs no
// secret at all.
func (c *ConfigureService) reconcileBuiltInAIProviders() {
	tombstones := seeding.LoadTombstones(c.store)
	now := time.Now()
	c.mu.Lock()
	byID := make(map[string]int, len(c.aiProviders))
	for i, p := range c.aiProviders {
		byID[p.ID] = i
	}
	changed := false
	for _, golden := range aiprovider.BuiltIn() {
		idx, present := byID[golden.ID]
		if !present {
			if tombstones[golden.ID] {
				continue
			}
			golden.CreatedAt, golden.UpdatedAt = now, now
			c.aiProviders = append(c.aiProviders, golden)
			changed = true
			continue
		}
		existing := c.aiProviders[idx]
		if existing.Seed.SeedRevision == 0 {
			existing.Seed = seedorigin.Origin{SeedRevision: golden.Seed.SeedRevision, Modified: true}
			c.aiProviders[idx] = existing
			changed = true
			continue
		}
		if existing.Seed.Modified {
			continue
		}
		if existing.Seed.SeedRevision < golden.Seed.SeedRevision {
			c.aiProviders[idx] = upgradeAIProviderToGolden(existing, golden, now)
			changed = true
		}
	}
	c.mu.Unlock()
	if changed {
		if err := c.persistAIProviders(); err != nil {
			slog.Error("failed to reconcile built-in AI providers", "error", err)
		}
	}
}

func upgradeAIProviderToGolden(existing, golden aiprovider.AIProvider, now time.Time) aiprovider.AIProvider {
	golden.CreatedAt = existing.CreatedAt
	golden.UpdatedAt = now
	golden.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
	return golden
}
