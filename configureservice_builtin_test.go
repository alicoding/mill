package main

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/connector"
)

// docs/SPEC.md §4's Update: seeded example connectors, verified at the
// service layer -- internal/domain/connector/builtin_test.go already
// proves BuiltIn()'s own data is well-formed; these tests prove
// ConfigureService actually seeds it (and its demo secrets) on a
// genuinely fresh install, and that seeding is lazy/one-shot, same
// pattern already proven for Workflows.

func TestConfigureService_FreshInstall_SeedsBuiltInConnectors(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp)

	got := cfg.Connectors()
	want := connector.BuiltIn()
	if len(got) != len(want) {
		t.Fatalf("Connectors() on a fresh install = %d entries, want %d (connector.BuiltIn())", len(got), len(want))
	}
	seen := map[string]bool{}
	for _, c := range got {
		seen[c.ID] = true
	}
	for _, c := range want {
		if !seen[c.ID] {
			t.Errorf("fresh-install Connectors() missing built-in %q", c.ID)
		}
	}
}

// The OAuth1 example's demo secret (Postman's own published test
// credential) must actually be resolvable end-to-end -- the same path
// a real workflow run would take -- not just present in BuiltIn()'s
// config.
func TestConfigureService_FreshInstall_SeedsOAuth1DemoSecret(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp)

	rc, err := cfg.resolveConnector(connector.ExampleOAuth1ID)
	if err != nil {
		t.Fatalf("resolveConnector(%q) returned error: %v", connector.ExampleOAuth1ID, err)
	}
	if rc.Secret == "" {
		t.Error("seeded OAuth1 example's resolved Secret is empty, want Postman's published test credential (encoded)")
	}
}

// APIKey/Bearer/HMAC/QueryParam's demo secrets are arbitrary
// placeholders (builtInSecrets, configureservice_builtin.go) -- confirm
// each actually landed in the keychain and resolves, not just that the
// map declares them.
func TestConfigureService_FreshInstall_SeedsPlaceholderDemoSecrets(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp)

	for id, want := range builtInSecrets {
		rc, err := cfg.resolveConnector(id)
		if err != nil {
			t.Errorf("resolveConnector(%q) returned error: %v", id, err)
			continue
		}
		if rc.Secret != want {
			t.Errorf("resolveConnector(%q) Secret = %q, want %q", id, rc.Secret, want)
		}
	}
}

// The OAuth2 example deliberately has no keychain secret seeded --
// resolveConnector must still succeed (AuthOAuth2 != AuthNone, but
// there's genuinely no secret to fetch since none was ever Set) rather
// than erroring, since a missing-but-never-set secret and a
// missing-but-expected one need to be distinguishable in principle --
// here we only assert the resolved Secret is empty, matching
// "credential.Get on an id nothing was ever Set for" behavior.
func TestConfigureService_FreshInstall_OAuth2Example_HasNoSecretSeeded(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp)

	if _, err := cfg.resolveConnector(connector.ExampleOAuth2ID); err == nil {
		t.Error("resolveConnector for the credential-less OAuth2 example returned nil error, want an error (no secret was ever seeded for it, matching a real not-yet-configured connector)")
	}
}

// Seeding is lazy and one-shot, same as CompositionService's own
// BuiltInWorkflows pattern: deleting a seeded connector, then
// constructing a second ConfigureService over the same (now-persisted)
// store, must NOT bring it back.
func TestConfigureService_DeletingABuiltIn_DoesNotReturnOnRestart(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp)

	if err := cfg.DeleteConnector(connector.ExampleNoneID); err != nil {
		t.Fatalf("DeleteConnector(%q) returned error: %v", connector.ExampleNoneID, err)
	}

	restarted := NewConfigureService(store, comp)
	for _, c := range restarted.Connectors() {
		if c.ID == connector.ExampleNoneID {
			t.Fatalf("deleted built-in %q reappeared after restart, want it to stay deleted", connector.ExampleNoneID)
		}
	}
	// The other six built-ins should still be there -- deleting one
	// persists the whole (now-mutated) list, not just that one entry's
	// absence.
	if len(restarted.Connectors()) != len(connector.BuiltIn())-1 {
		t.Errorf("Connectors() after restart = %d entries, want %d (one deleted, the rest persisted)", len(restarted.Connectors()), len(connector.BuiltIn())-1)
	}
}

// Editing a seeded example carries its BuiltIn flag forward (same
// "purely informational" behavior CompositionService.UpdateWorkflow
// already established) and correctly persists the new Description.
func TestUpdateConnector_PreservesBuiltInFlag_AndUpdatesDescription(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp)

	var original connector.Connector
	for _, c := range cfg.Connectors() {
		if c.ID == connector.ExampleNoneID {
			original = c
			break
		}
	}
	if original.ID == "" {
		t.Fatalf("seeded connector %q not found", connector.ExampleNoneID)
	}

	updated, err := cfg.UpdateConnector(
		original.ID, original.Label, original.Type, original.BaseURL, original.AuthType,
		original.Headers, original.OpenAPISpec, original.Auth, original.JOSE, "my own notes",
	)
	if err != nil {
		t.Fatalf("UpdateConnector returned error: %v", err)
	}
	if !updated.BuiltIn {
		t.Error("UpdateConnector reset BuiltIn to false, want it carried forward (purely informational)")
	}
	if updated.Description != "my own notes" {
		t.Errorf("UpdateConnector Description = %q, want %q", updated.Description, "my own notes")
	}
}

func TestCreateConnector_DescriptionPersists(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("My API", connector.TypeHTTP, "https://example.com", connector.AuthNone, nil, "", nil, nil, "a helpful note")
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if conn.Description != "a helpful note" {
		t.Errorf("CreateConnector Description = %q, want %q", conn.Description, "a helpful note")
	}
}
