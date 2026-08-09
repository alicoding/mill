package main

import (
	"encoding/json"
	"sort"

	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/httprequest"
)

// builtInSecrets holds the demo secret VALUES for httprequest.BuiltIn()'s
// seeded examples -- kept here, in package main, not in
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

// --- seed tombstones (shared by CompositionService/ConfigureService) ---

// seedTombstonesKey records built-in example IDs the user deliberately
// deleted, so top-up seeding (topUpBuiltIns on each service) never
// resurrects them -- seeds are top-up rather than fresh-install-only by
// direct user decision ("every feature we build needs proof with a
// seeded example" -- a new example must reach an existing instance),
// and the tombstone is what keeps §2.2's fully-deletable principle
// true at the same time.
const seedTombstonesKey = "seed-tombstones"

func loadTombstones(store settings.Store) map[string]bool {
	out := map[string]bool{}
	raw, ok := store.Get(seedTombstonesKey).(string)
	if !ok || raw == "" {
		return out
	}
	var ids []string
	if err := json.Unmarshal([]byte(raw), &ids); err != nil {
		return out
	}
	for _, id := range ids {
		out[id] = true
	}
	return out
}

// recordTombstone persists id into the tombstone list -- call only for
// IDs that belong to a built-in seed set (a user-authored ID can never
// be resurrected by top-up, so tombstoning it would be dead weight).
func recordTombstone(store settings.Store, id string) {
	tombstones := loadTombstones(store)
	if tombstones[id] {
		return
	}
	tombstones[id] = true
	ids := make([]string, 0, len(tombstones))
	for t := range tombstones {
		ids = append(ids, t)
	}
	sort.Strings(ids)
	data, err := json.Marshal(ids)
	if err != nil {
		return
	}
	_ = store.Set(seedTombstonesKey, string(data))
}

// topUpBuiltInRequests mirrors CompositionService.topUpBuiltIns for the
// seeded example HTTPRequests: any built-in whose ID is neither present
// nor tombstoned is appended (and its demo secret seeded), so a newly
// shipped example reaches existing instances too.
func (c *ConfigureService) topUpBuiltInRequests() {
	tombstones := loadTombstones(c.store)
	c.mu.Lock()
	have := make(map[string]bool, len(c.requests))
	for _, r := range c.requests {
		have[r.ID] = true
	}
	var added []httprequest.HTTPRequest
	for _, r := range httprequest.BuiltIn() {
		if !have[r.ID] && !tombstones[r.ID] {
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
