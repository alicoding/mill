package configuresvc

import (
	"log/slog"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/services/entitystore"
	"github.com/alicoding/mill/internal/services/seeding"
)

// httpRequestDescriptor is HTTPRequest's entitystore.Descriptor (goal
// 0165) -- only reconcileBuiltInRequests and the Reset/Restorable/
// Restore RPCs (configureservice_seedlifecycle.go) key off it.
// Create/Update/Delete stay hand-written in
// configureservice_requestauth.go: they interleave credential/JOSE
// handling the generic shape doesn't cover.
var httpRequestDescriptor = entitystore.Descriptor[httprequest.HTTPRequest]{
	Label:     "request",
	GetID:     func(r httprequest.HTTPRequest) string { return r.ID },
	IsBuiltIn: func(r httprequest.HTTPRequest) bool { return r.BuiltIn },
	GetSeed:   func(r httprequest.HTTPRequest) seedorigin.Origin { return r.Seed },
	SetSeed:   func(r httprequest.HTTPRequest, o seedorigin.Origin) httprequest.HTTPRequest { r.Seed = o; return r },
	StampNew: func(r httprequest.HTTPRequest, now time.Time) httprequest.HTTPRequest {
		r.CreatedAt, r.UpdatedAt = now, now
		return r
	},
	Upgrade: upgradeRequestToGolden,
	BuiltIn: httprequest.BuiltIn,
}

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

// builtInOAuth1SecretFor returns the demo OAuth 1.0a credential for a
// seeded example, in the same single-slot encoding every stored OAuth
// 1.0a credential used, so the adoption pass decodes it through one
// decoder rather than special-casing where a value came from. Empty for
// any request that is not that example.
//
// Nothing here is written to the OS keychain any more (goal 0306): a
// seeded example's demo credential becomes a store entry on the first
// unlock, so there is exactly one place a credential is ever created.
func builtInOAuth1SecretFor(id string) string {
	if id != httprequest.ExampleOAuth1ID {
		return ""
	}
	return composition.EncodeOAuth1Secret(builtInOAuth1ConsumerSecret, "")
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
	seededSecretsFor, changed := entitystore.Reconcile(&c.mu, &c.requests, tombstones, httpRequestDescriptor)
	if !changed {
		return
	}
	// Startup reconciliation, not a user-initiated RPC -- log-only, same
	// fire-and-forget treatment the old top-up functions already used
	// (docs/goals/0025 item 1).
	if err := c.persistHTTPRequests(); err != nil {
		slog.Error("failed to reconcile built-in HTTPRequests", "error", err)
	}
	// A newly-inserted example's demo credential is not created here:
	// the store may well be locked at startup, and creating a
	// credential anywhere but the store is exactly what goal 0306 ends.
	// AdoptSecretsIntoStore gives the example its entry on the next
	// unlock, and only while the example still names none.
	_ = seededSecretsFor
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
// seeded example Lists (docs/goals/0010 item 4) via listDescriptor
// (configurelist.go, goal 0165). A List carries no secret, same
// "simpler than the HTTPRequest version" reasoning
// reconcileBuiltInDecisions already gives.
func (c *ConfigureService) reconcileBuiltInLists() {
	tombstones := seeding.LoadTombstones(c.store)
	if _, changed := entitystore.Reconcile(&c.mu, &c.lists, tombstones, listDescriptor); changed {
		if err := c.persistLists(); err != nil {
			slog.Error("failed to reconcile built-in Lists", "error", err)
		}
	}
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

// reconcileBuiltInAIProviders mirrors reconcileBuiltInMCPServers for
// the seeded example AI provider (docs/goals/0031-ai-node-family.md)
// via aiProviderDescriptor (configureaiprovider.go, goal 0165). No
// credential seeding step: the seeded "Local Ollama" example needs no
// secret at all.
func (c *ConfigureService) reconcileBuiltInAIProviders() {
	tombstones := seeding.LoadTombstones(c.store)
	if _, changed := entitystore.Reconcile(&c.mu, &c.aiProviders, tombstones, aiProviderDescriptor); changed {
		if err := c.persistAIProviders(); err != nil {
			slog.Error("failed to reconcile built-in AI providers", "error", err)
		}
	}
}
