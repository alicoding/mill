package httprequest

import (
	"encoding/json"
	"testing"
)

// docs/SPEC.md §4's Update: every seeded example request must itself
// be a well-formed HTTPRequest (the same "never store an unconfigured/
// invalid value" discipline Validate already enforces for user-created
// ones) -- a broken built-in would silently ship as a bad first
// impression, not caught by any compiler check.
func TestBuiltIn_EveryRequestIsValid(t *testing.T) {
	for _, c := range BuiltIn() {
		if err := Validate(c); err != nil {
			t.Errorf("BuiltIn() request %q failed Validate: %v", c.ID, err)
		}
	}
}

func TestBuiltIn_EveryRequestIsMarkedBuiltIn(t *testing.T) {
	for _, c := range BuiltIn() {
		if !c.BuiltIn {
			t.Errorf("BuiltIn() request %q has BuiltIn=false, want true", c.ID)
		}
	}
}

func TestBuiltIn_IDsAreUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, c := range BuiltIn() {
		if seen[c.ID] {
			t.Errorf("BuiltIn() has a duplicate ID: %q", c.ID)
		}
		seen[c.ID] = true
	}
}

// Every seeded example's OpenAPISpec must actually parse as valid JSON
// -- openAPISpecFor's own hand-built string concatenation has no
// compile-time schema check, so a typo here would only surface at
// runtime (ListConnectorOperations returning an error) rather than
// failing this test.
func TestBuiltIn_EveryOpenAPISpecIsValidJSON(t *testing.T) {
	for _, c := range BuiltIn() {
		var v any
		if err := json.Unmarshal([]byte(c.OpenAPISpec), &v); err != nil {
			t.Errorf("BuiltIn() request %q has invalid JSON OpenAPISpec: %v", c.ID, err)
		}
	}
}

// AuthOAuth1Vendor and AuthMTLS are stub strategies (ADR-0015) that
// always fail -- an example that's guaranteed to fail isn't a working
// example (BuiltIn's own doc comment). Confirms that principle is
// actually honored, not just stated.
func TestBuiltIn_NoStubAuthTypeIsDemonstrated(t *testing.T) {
	for _, c := range BuiltIn() {
		if c.AuthType == AuthOAuth1Vendor || c.AuthType == AuthMTLS {
			t.Errorf("BuiltIn() request %q uses stub AuthType %q, which always fails -- not a working example", c.ID, c.AuthType)
		}
	}
}

// The OAuth2 example deliberately ships without a real client secret
// (BuiltIn's own doc comment: Mill's repo will never carry one) -- this
// locks that as an intentional, tested property rather than something
// a future edit could silently break by adding a fake-but-plausible
// secret-shaped value.
func TestBuiltIn_OAuth2Example_HasNoClientIDPreFilled(t *testing.T) {
	for _, c := range BuiltIn() {
		if c.AuthType == AuthOAuth2 && c.Auth != nil && c.Auth.OAuth2 != nil && c.Auth.OAuth2.ClientID != "" {
			t.Errorf("BuiltIn() OAuth2 request %q has a pre-filled ClientID, want empty (bring-your-own-credentials by design)", c.ID)
		}
	}
}
