package main

import (
	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/connector"
)

// builtInSecrets holds the demo secret VALUES for connector.BuiltIn()'s
// seeded examples -- kept here, in package main, not in
// internal/domain/connector, since Connector itself never carries a
// secret field (domain purity -- ADR-0007's own "the secret itself
// never lives on a Connector value at all" rule) -- only the layer
// that already owns credential.Set calls should own these values too.
//
// Every value here is either a publicly-published test credential
// (Postman's own OAuth1 example, safe and intended to be shared) or an
// arbitrary placeholder string for an endpoint that doesn't actually
// validate the secret's value (httpbin.org's /headers, /get -- it just
// echoes back whatever it received, docs/SPEC.md §4's own honest
// caveat on those examples' Description). AuthOAuth2's example
// deliberately has no entry here -- Mill's own repo will never carry a
// real client secret, see connector.BuiltIn()'s own doc comment.
var builtInSecrets = map[string]string{
	connector.ExampleAPIKeyID:     "demo-api-key-do-not-use-in-production",
	connector.ExampleBearerID:     "demo-bearer-token-do-not-use-in-production",
	connector.ExampleHMACID:       "demo-hmac-signing-key-do-not-use-in-production",
	connector.ExampleQueryParamID: "demo-query-api-key-do-not-use-in-production",
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
// same as every other credential.Set call site in this codebase: a
// keychain write can fail (headless/sandboxed CI, a locked keychain),
// and a failed *demo* secret write should degrade to "this one example
// needs the user to fill in their own secret," not crash startup.
func (c *ConfigureService) seedBuiltInSecrets() {
	for id, secret := range builtInSecrets {
		_ = credential.Set(id, secret)
	}
	_ = credential.Set(connector.ExampleOAuth1ID, composition.EncodeOAuth1Secret(builtInOAuth1ConsumerSecret, ""))
}
