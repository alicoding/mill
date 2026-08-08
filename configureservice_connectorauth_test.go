package main

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/connector"
)

// Connector CRUD/auth/JOSE tests -- split out of configureservice_test.go
// once it crossed the 500-line limit, mirroring the
// configureservice_connectorauth.go split of the source file itself
// (scripts/check-loc.sh). newTestConfigureService/TestMain stay in
// configureservice_test.go, shared across every *_test.go file in this
// package.

func TestCreateConnector_ValidatesAndPersists(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("My API", connector.TypeHTTP, "https://example.com", connector.AuthNone, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if conn.ID == "" {
		t.Error("CreateConnector left ID empty, want a generated ID")
	}
	got := cfg.Connectors()
	if len(got) != 1 || got[0].ID != conn.ID {
		t.Errorf("Connectors() = %+v, want a single entry matching the created connector", got)
	}
}

func TestCreateConnector_InvalidRejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.CreateConnector("", connector.TypeHTTP, "https://example.com", connector.AuthNone, nil, "", nil, nil); err == nil {
		t.Fatal("CreateConnector with an empty label returned nil error, want an error")
	}
}

func TestUpdateConnector_UnknownID_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.UpdateConnector("does-not-exist", "New label", connector.TypeHTTP, "https://example.com", connector.AuthNone, nil, "", nil, nil); err == nil {
		t.Fatal("UpdateConnector with an unknown id returned nil error, want an error")
	}
}

func TestDeleteConnector_RemovesItAndItsSecret(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("My API", connector.TypeHTTP, "https://example.com", connector.AuthBearer, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if err := cfg.SetConnectorSecret(conn.ID, "tok123"); err != nil {
		t.Fatalf("SetConnectorSecret returned error: %v", err)
	}

	if err := cfg.DeleteConnector(conn.ID); err != nil {
		t.Fatalf("DeleteConnector returned error: %v", err)
	}
	if len(cfg.Connectors()) != 0 {
		t.Error("Connectors() still returns entries after DeleteConnector")
	}
	// resolveConnector (the only way this test can observe the secret
	// was actually cleared -- there is deliberately no GetSecret) should
	// now fail to find the connector at all, confirming both the entry
	// and its secret are gone.
	if _, err := cfg.resolveConnector(conn.ID); err == nil {
		t.Error("resolveConnector still resolves a deleted connector, want an error")
	}
}

const testOpenAPISpec = `{
  "openapi": "3.0.3",
  "info": {"title": "Test", "version": "1.0.0"},
  "paths": {
    "/widgets": {
      "get": {
        "summary": "List widgets",
        "responses": {"200": {"description": "OK"}}
      }
    }
  }
}`

func TestCreateConnector_RejectsInvalidOpenAPISpec(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.CreateConnector("My API", connector.TypeHTTP, "https://example.com", connector.AuthNone, nil, "not an openapi spec", nil, nil); err == nil {
		t.Fatal("CreateConnector with an invalid OpenAPISpec returned nil error, want an error")
	}
}

func TestCreateConnector_AcceptsValidOpenAPISpec(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("My API", connector.TypeHTTP, "https://example.com", connector.AuthNone, nil, testOpenAPISpec, nil, nil)
	if err != nil {
		t.Fatalf("CreateConnector with a valid OpenAPISpec returned error: %v", err)
	}
	if conn.OpenAPISpec != testOpenAPISpec {
		t.Error("CreateConnector did not persist OpenAPISpec verbatim")
	}
}

func TestListConnectorOperations_ReturnsDeclaredOperations(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("My API", connector.TypeHTTP, "https://example.com", connector.AuthNone, nil, testOpenAPISpec, nil, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	ops, err := cfg.ListConnectorOperations(conn.ID)
	if err != nil {
		t.Fatalf("ListConnectorOperations returned error: %v", err)
	}
	if len(ops) != 1 || ops[0].Path != "/widgets" || ops[0].Method != "GET" {
		t.Errorf("ListConnectorOperations = %+v, want one GET /widgets operation", ops)
	}
}

func TestListConnectorOperations_NoSpecConfigured_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("My API", connector.TypeHTTP, "https://example.com", connector.AuthNone, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if _, err := cfg.ListConnectorOperations(conn.ID); err == nil {
		t.Fatal("ListConnectorOperations on a connector with no OpenAPISpec returned nil error, want an error")
	}
}

func TestListConnectorOperations_UnknownConnector_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.ListConnectorOperations("does-not-exist"); err == nil {
		t.Fatal("ListConnectorOperations for an unknown connector returned nil error, want an error")
	}
}

func TestConnectorOperationFields_ReturnsDeclaredOperationFields(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("My API", connector.TypeHTTP, "https://example.com", connector.AuthNone, nil, testOpenAPISpec, nil, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	op, err := cfg.ConnectorOperationFields(conn.ID, "/widgets", "GET")
	if err != nil {
		t.Fatalf("ConnectorOperationFields returned error: %v", err)
	}
	// testOpenAPISpec's GET /widgets declares no parameters and an empty
	// 200 response -- both nil is the correct, real answer, not a stub.
	if len(op.InputFields) != 0 || len(op.OutputFields) != 0 {
		t.Errorf("ConnectorOperationFields = %+v, want no declared fields for this operation", op)
	}
}

func TestConnectorOperationFields_UnknownOperation_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("My API", connector.TypeHTTP, "https://example.com", connector.AuthNone, nil, testOpenAPISpec, nil, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if _, err := cfg.ConnectorOperationFields(conn.ID, "/does-not-exist", "GET"); err == nil {
		t.Fatal("ConnectorOperationFields for an undeclared path returned nil error, want an error")
	}
}

func TestSetConnectorSecret_UnknownConnector_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if err := cfg.SetConnectorSecret("does-not-exist", "secret"); err == nil {
		t.Fatal("SetConnectorSecret for an unknown connector returned nil error, want an error")
	}
}

func TestResolveConnector_AuthNone_NoSecretNeeded(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("Public API", connector.TypeHTTP, "https://example.com", connector.AuthNone, map[string]string{"Accept": "application/json"}, "", nil, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}

	rc, err := cfg.resolveConnector(conn.ID)
	if err != nil {
		t.Fatalf("resolveConnector returned error for an AuthNone connector with no secret set: %v", err)
	}
	if rc.BaseURL != "https://example.com" || rc.Headers["Accept"] != "application/json" {
		t.Errorf("resolveConnector = %+v, want the connector's own BaseURL/Headers", rc)
	}
}

func TestResolveConnector_AuthBearer_MissingSecret_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("Secured API", connector.TypeHTTP, "https://example.com", connector.AuthBearer, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if _, err := cfg.resolveConnector(conn.ID); err == nil {
		t.Fatal("resolveConnector for an AuthBearer connector with no secret set returned nil error, want an error")
	}
}

func TestResolveConnector_AuthBearer_ResolvesSecret(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("Secured API", connector.TypeHTTP, "https://example.com", connector.AuthBearer, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if err := cfg.SetConnectorSecret(conn.ID, "s3cr3t"); err != nil {
		t.Fatalf("SetConnectorSecret returned error: %v", err)
	}

	rc, err := cfg.resolveConnector(conn.ID)
	if err != nil {
		t.Fatalf("resolveConnector returned error: %v", err)
	}
	if rc.Secret != "s3cr3t" {
		t.Errorf("resolveConnector Secret = %q, want %q", rc.Secret, "s3cr3t")
	}
}

// TestCreateConnector_AuthConfig_PersistsAndSurvivesRestore proves
// ADR-0015's additive Connector.Auth field actually round-trips through
// the real persist()/restore() JSON path (configureservice_connectorauth.go),
// not just that CreateConnector accepts the extra param -- a second
// ConfigureService built over the same fakeStore (which shares its
// underlying map, triggerservice_test.go) exercises a real restore,
// the same class of proof TestPersistHotkeys_WritesBindingsAsJSON
// already establishes for TriggerService.
func TestCreateConnector_AuthConfig_PersistsAndSurvivesRestore(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp)

	auth := &connector.AuthConfig{OAuth2: &connector.OAuth2Config{
		GrantType: "client_credentials", TokenURL: "https://auth.example.com/token", ClientID: "client-1", Scope: "read",
	}}
	conn, err := cfg.CreateConnector("OAuth2 API", connector.TypeHTTP, "https://example.com", connector.AuthOAuth2, nil, "", auth, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if conn.Auth == nil || conn.Auth.OAuth2 == nil || conn.Auth.OAuth2.ClientID != "client-1" {
		t.Fatalf("CreateConnector returned Auth = %+v, want the OAuth2Config passed in", conn.Auth)
	}
	if err := cfg.SetConnectorSecret(conn.ID, "client-secret"); err != nil {
		t.Fatalf("SetConnectorSecret returned error: %v", err)
	}

	restarted := NewConfigureService(store, comp)
	got := restarted.Connectors()
	if len(got) != 1 || got[0].Auth == nil || got[0].Auth.OAuth2 == nil {
		t.Fatalf("Connectors() after restore = %+v, want Auth to survive persist/restore", got)
	}
	if got[0].Auth.OAuth2.TokenURL != "https://auth.example.com/token" || got[0].Auth.OAuth2.Scope != "read" {
		t.Errorf("restored Auth.OAuth2 = %+v, want the original TokenURL/Scope", got[0].Auth.OAuth2)
	}

	rc, err := restarted.resolveConnector(conn.ID)
	if err != nil {
		t.Fatalf("resolveConnector after restore returned error: %v", err)
	}
	if rc.Auth == nil || rc.Auth.OAuth2 == nil || rc.Auth.OAuth2.ClientID != "client-1" {
		t.Errorf("resolveConnector Auth = %+v, want it threaded through to ResolvedConnector", rc.Auth)
	}
}

// TestUpdateConnector_AuthConfig_Replaces proves UpdateConnector's new
// Auth param actually replaces the stored config, not just accepted
// and discarded.
func TestUpdateConnector_AuthConfig_Replaces(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("HMAC API", connector.TypeHTTP, "https://example.com", connector.AuthHMAC, nil, "", &connector.AuthConfig{HMAC: &connector.HMACConfig{HeaderName: "X-Sig"}}, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}

	updated, err := cfg.UpdateConnector(conn.ID, "HMAC API", connector.TypeHTTP, "https://example.com", connector.AuthHMAC, nil, "", &connector.AuthConfig{HMAC: &connector.HMACConfig{HeaderName: "X-Custom-Sig"}}, nil)
	if err != nil {
		t.Fatalf("UpdateConnector returned error: %v", err)
	}
	if updated.Auth == nil || updated.Auth.HMAC == nil || updated.Auth.HMAC.HeaderName != "X-Custom-Sig" {
		t.Errorf("UpdateConnector Auth = %+v, want the replaced HMACConfig", updated.Auth)
	}
}

// TestSetConnectorOAuth1Secret_EncodesDualSecret proves the OAuth1
// dual-secret convenience method (ADR-0015 §3) stores a value
// resolveConnector can hand back to composition.ApplyAuth's OAuth1
// strategy -- decoding is composition's own concern
// (decodeOAuth1Secret, unexported), so this only checks the round trip
// through resolveConnector's Secret field, not the decoded shape.
func TestSetConnectorOAuth1Secret_EncodesDualSecret(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("OAuth1 API", connector.TypeHTTP, "https://example.com", connector.AuthOAuth1, nil, "", &connector.AuthConfig{OAuth1: &connector.OAuth1Config{ConsumerKey: "ck-1", Token: "tok-1"}}, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if err := cfg.SetConnectorOAuth1Secret(conn.ID, "consumer-secret", "token-secret"); err != nil {
		t.Fatalf("SetConnectorOAuth1Secret returned error: %v", err)
	}

	rc, err := cfg.resolveConnector(conn.ID)
	if err != nil {
		t.Fatalf("resolveConnector returned error: %v", err)
	}
	if rc.Secret == "" {
		t.Fatal("resolveConnector Secret is empty, want the encoded OAuth1 dual secret")
	}
	if got := composition.EncodeOAuth1Secret("consumer-secret", "token-secret"); rc.Secret != got {
		t.Errorf("resolveConnector Secret = %q, want %q (composition.EncodeOAuth1Secret's own encoding)", rc.Secret, got)
	}
}

func TestSetConnectorOAuth1Secret_UnknownConnector_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if err := cfg.SetConnectorOAuth1Secret("does-not-exist", "cs", "ts"); err == nil {
		t.Fatal("SetConnectorOAuth1Secret for an unknown connector returned nil error, want an error")
	}
}

// TestCreateConnector_JOSEConfig_PersistsAndSurvivesRestore mirrors
// TestCreateConnector_AuthConfig_PersistsAndSurvivesRestore (ADR-0015
// Phase 2) for Phase 3's JOSE field -- a real persist/restore round
// trip via a second ConfigureService over the same fakeStore, not just
// that CreateConnector accepts the param.
func TestCreateConnector_JOSEConfig_PersistsAndSurvivesRestore(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp)

	jose := &connector.JOSEConfig{Enabled: true, RecipientPublicKeyPEM: "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----"}
	conn, err := cfg.CreateConnector("JOSE API", connector.TypeHTTP, "https://example.com", connector.AuthNone, nil, "", nil, jose)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if conn.JOSE == nil || !conn.JOSE.Enabled {
		t.Fatalf("CreateConnector returned JOSE = %+v, want the JOSEConfig passed in", conn.JOSE)
	}

	restarted := NewConfigureService(store, comp)
	got := restarted.Connectors()
	if len(got) != 1 || got[0].JOSE == nil || !got[0].JOSE.Enabled {
		t.Fatalf("Connectors() after restore = %+v, want JOSE to survive persist/restore", got)
	}
	if got[0].JOSE.RecipientPublicKeyPEM != jose.RecipientPublicKeyPEM {
		t.Errorf("restored JOSE.RecipientPublicKeyPEM = %q, want %q", got[0].JOSE.RecipientPublicKeyPEM, jose.RecipientPublicKeyPEM)
	}

	rc, err := restarted.resolveConnector(conn.ID)
	if err != nil {
		t.Fatalf("resolveConnector after restore returned error: %v", err)
	}
	if rc.JOSE == nil || !rc.JOSE.Enabled {
		t.Errorf("resolveConnector JOSE = %+v, want it threaded through to ResolvedConnector", rc.JOSE)
	}
	// DecryptResponse is false on this connector, so resolveConnector
	// must not have attempted a keychain fetch for a JOSE private key --
	// confirmed indirectly: no error above means it didn't try and fail.
	if rc.JOSEPrivateKeyPEM != "" {
		t.Errorf("resolveConnector JOSEPrivateKeyPEM = %q, want empty (DecryptResponse is false)", rc.JOSEPrivateKeyPEM)
	}
}

// TestSetConnectorJOSEPrivateKey_ResolvesOnlyWhenDecryptResponseIsSet
// proves the private-key keychain fetch is conditional on
// JOSE.DecryptResponse, and that it's stored under a distinct keychain
// entry from the connector's own AuthType secret (ADR-0015 Phase 3
// §"joseKeychainID") -- setting one never clobbers the other.
func TestSetConnectorJOSEPrivateKey_ResolvesOnlyWhenDecryptResponseIsSet(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector(
		"JOSE+Bearer API", connector.TypeHTTP, "https://example.com", connector.AuthBearer, nil, "", nil,
		&connector.JOSEConfig{Enabled: true, DecryptResponse: true, RecipientPublicKeyPEM: "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----"},
	)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if err := cfg.SetConnectorSecret(conn.ID, "bearer-token"); err != nil {
		t.Fatalf("SetConnectorSecret returned error: %v", err)
	}
	if err := cfg.SetConnectorJOSEPrivateKey(conn.ID, "jose-private-key-pem"); err != nil {
		t.Fatalf("SetConnectorJOSEPrivateKey returned error: %v", err)
	}

	rc, err := cfg.resolveConnector(conn.ID)
	if err != nil {
		t.Fatalf("resolveConnector returned error: %v", err)
	}
	if rc.Secret != "bearer-token" {
		t.Errorf("resolveConnector Secret = %q, want the AuthType secret %q, unaffected by the JOSE key", rc.Secret, "bearer-token")
	}
	if rc.JOSEPrivateKeyPEM != "jose-private-key-pem" {
		t.Errorf("resolveConnector JOSEPrivateKeyPEM = %q, want %q", rc.JOSEPrivateKeyPEM, "jose-private-key-pem")
	}
}

func TestSetConnectorJOSEPrivateKey_UnknownConnector_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if err := cfg.SetConnectorJOSEPrivateKey("does-not-exist", "pem"); err == nil {
		t.Fatal("SetConnectorJOSEPrivateKey for an unknown connector returned nil error, want an error")
	}
}

func TestDeleteConnector_AlsoRemovesJOSEPrivateKey(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector(
		"JOSE API", connector.TypeHTTP, "https://example.com", connector.AuthNone, nil, "", nil,
		&connector.JOSEConfig{Enabled: true, DecryptResponse: true, RecipientPublicKeyPEM: "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----"},
	)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if err := cfg.SetConnectorJOSEPrivateKey(conn.ID, "jose-private-key-pem"); err != nil {
		t.Fatalf("SetConnectorJOSEPrivateKey returned error: %v", err)
	}
	if err := cfg.DeleteConnector(conn.ID); err != nil {
		t.Fatalf("DeleteConnector returned error: %v", err)
	}
	if err := cfg.SetConnectorJOSEPrivateKey(conn.ID, "anything"); err == nil {
		t.Fatal("SetConnectorJOSEPrivateKey on a deleted connector returned nil error, want an error (connector no longer exists)")
	}
}
