package configuresvc

import (
	"testing"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// HTTPRequest CRUD/auth/JOSE tests -- split out of configureservice_test.go
// once it crossed the 500-line limit, mirroring the
// configureservice_requestauth.go split of the source file itself
// (scripts/check-loc.sh). newTestConfigureService/TestMain stay in
// configureservice_test.go, shared across every *_test.go file in this
// package.

func TestCreateHTTPRequest_ValidatesAndPersists(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest("My API", "https://example.com", "", "", httprequest.AuthNone, nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}
	if req.ID == "" {
		t.Error("CreateHTTPRequest left ID empty, want a generated ID")
	}
	got := cfg.HTTPRequests()
	if len(got) != 1 || got[0].ID != req.ID {
		t.Errorf("HTTPRequests() = %+v, want a single entry matching the created request", got)
	}
}

func TestCreateHTTPRequest_InvalidRejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.CreateHTTPRequest("", "https://example.com", "", "", httprequest.AuthNone, nil, "", nil, nil, ""); err == nil {
		t.Fatal("CreateHTTPRequest with an empty label returned nil error, want an error")
	}
}

func TestUpdateHTTPRequest_UnknownID_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.UpdateHTTPRequest("does-not-exist", "New label", "https://example.com", "", "", httprequest.AuthNone, nil, "", nil, nil, ""); err == nil {
		t.Fatal("UpdateHTTPRequest with an unknown id returned nil error, want an error")
	}
}

func TestDeleteHTTPRequest_RemovesItAndItsSecret(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest("My API", "https://example.com", "", "", httprequest.AuthBearer, nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}
	if err := cfg.SetHTTPRequestSecret(req.ID, "tok123"); err != nil {
		t.Fatalf("SetHTTPRequestSecret returned error: %v", err)
	}

	if err := cfg.DeleteHTTPRequest(req.ID); err != nil {
		t.Fatalf("DeleteHTTPRequest returned error: %v", err)
	}
	if len(cfg.HTTPRequests()) != 0 {
		t.Error("HTTPRequests() still returns entries after DeleteHTTPRequest")
	}
	// resolveHTTPRequest (the only way this test can observe the secret
	// was actually cleared -- there is deliberately no GetSecret) should
	// now fail to find the request at all, confirming both the entry
	// and its secret are gone.
	if _, err := cfg.resolveHTTPRequest(req.ID); err == nil {
		t.Error("resolveHTTPRequest still resolves a deleted request, want an error")
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

func TestCreateHTTPRequest_RejectsInvalidOpenAPISpec(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.CreateHTTPRequest("My API", "https://example.com", "", "", httprequest.AuthNone, nil, "not an openapi spec", nil, nil, ""); err == nil {
		t.Fatal("CreateHTTPRequest with an invalid OpenAPISpec returned nil error, want an error")
	}
}

func TestCreateHTTPRequest_AcceptsValidOpenAPISpec(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest("My API", "https://example.com", "", "", httprequest.AuthNone, nil, testOpenAPISpec, nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest with a valid OpenAPISpec returned error: %v", err)
	}
	if req.OpenAPISpec != testOpenAPISpec {
		t.Error("CreateHTTPRequest did not persist OpenAPISpec verbatim")
	}
}

func TestListHTTPRequestOperations_ReturnsDeclaredOperations(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest("My API", "https://example.com", "", "", httprequest.AuthNone, nil, testOpenAPISpec, nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}
	ops, err := cfg.ListHTTPRequestOperations(req.ID)
	if err != nil {
		t.Fatalf("ListHTTPRequestOperations returned error: %v", err)
	}
	if len(ops) != 1 || ops[0].Path != "/widgets" || ops[0].Method != "GET" {
		t.Errorf("ListHTTPRequestOperations = %+v, want one GET /widgets operation", ops)
	}
}

func TestListHTTPRequestOperations_NoSpecConfigured_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest("My API", "https://example.com", "", "", httprequest.AuthNone, nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}
	if _, err := cfg.ListHTTPRequestOperations(req.ID); err == nil {
		t.Fatal("ListHTTPRequestOperations on a request with no OpenAPISpec returned nil error, want an error")
	}
}

func TestListHTTPRequestOperations_UnknownHTTPRequest_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.ListHTTPRequestOperations("does-not-exist"); err == nil {
		t.Fatal("ListHTTPRequestOperations for an unknown request returned nil error, want an error")
	}
}

func TestHTTPRequestOperationFields_ReturnsDeclaredOperationFields(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest("My API", "https://example.com", "", "", httprequest.AuthNone, nil, testOpenAPISpec, nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}
	op, err := cfg.HTTPRequestOperationFields(req.ID, "/widgets", "GET")
	if err != nil {
		t.Fatalf("HTTPRequestOperationFields returned error: %v", err)
	}
	// testOpenAPISpec's GET /widgets declares no parameters and an empty
	// 200 response -- both nil is the correct, real answer, not a stub.
	if len(op.InputFields) != 0 || len(op.OutputFields) != 0 {
		t.Errorf("HTTPRequestOperationFields = %+v, want no declared fields for this operation", op)
	}
}

func TestHTTPRequestOperationFields_UnknownOperation_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest("My API", "https://example.com", "", "", httprequest.AuthNone, nil, testOpenAPISpec, nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}
	if _, err := cfg.HTTPRequestOperationFields(req.ID, "/does-not-exist", "GET"); err == nil {
		t.Fatal("HTTPRequestOperationFields for an undeclared path returned nil error, want an error")
	}
}

func TestSetHTTPRequestSecret_UnknownHTTPRequest_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if err := cfg.SetHTTPRequestSecret("does-not-exist", "secret"); err == nil {
		t.Fatal("SetHTTPRequestSecret for an unknown request returned nil error, want an error")
	}
}

func TestResolveHTTPRequest_AuthNone_NoSecretNeeded(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest("Public API", "https://example.com", "", "", httprequest.AuthNone, map[string]string{"Accept": "application/json"}, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}

	rc, err := cfg.resolveHTTPRequest(req.ID)
	if err != nil {
		t.Fatalf("resolveHTTPRequest returned error for an AuthNone request with no secret set: %v", err)
	}
	if rc.BaseURL != "https://example.com" || rc.Headers["Accept"] != "application/json" {
		t.Errorf("resolveHTTPRequest = %+v, want the request's own BaseURL/Headers", rc)
	}
}

func TestResolveHTTPRequest_AuthBearer_MissingSecret_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest("Secured API", "https://example.com", "", "", httprequest.AuthBearer, nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}
	if _, err := cfg.resolveHTTPRequest(req.ID); err == nil {
		t.Fatal("resolveHTTPRequest for an AuthBearer request with no secret set returned nil error, want an error")
	}
}

func TestResolveHTTPRequest_AuthBearer_ResolvesSecret(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest("Secured API", "https://example.com", "", "", httprequest.AuthBearer, nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}
	if err := cfg.SetHTTPRequestSecret(req.ID, "s3cr3t"); err != nil {
		t.Fatalf("SetHTTPRequestSecret returned error: %v", err)
	}

	rc, err := cfg.resolveHTTPRequest(req.ID)
	if err != nil {
		t.Fatalf("resolveHTTPRequest returned error: %v", err)
	}
	if rc.Secret != "s3cr3t" {
		t.Errorf("resolveHTTPRequest Secret = %q, want %q", rc.Secret, "s3cr3t")
	}
}

// TestCreateHTTPRequest_AuthConfig_PersistsAndSurvivesRestore proves
// ADR-0015's additive HTTPRequest.Auth field actually round-trips through
// the real persist()/restore() JSON path (configureservice_requestauth.go),
// not just that CreateHTTPRequest accepts the extra param -- a second
// ConfigureService built over the same fakeStore (which shares its
// underlying map, triggerservice_test.go) exercises a real restore,
// the same class of proof TestPersistHotkeys_WritesBindingsAsJSON
// already establishes for TriggerService.
func TestCreateHTTPRequest_AuthConfig_PersistsAndSurvivesRestore(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := NewConfigureService(store, comp, credential.New())
	// Starts from an empty request list, not the seeded built-in
	// examples -- see newTestConfigureService's own doc comment
	// (configureservice_test.go) for why.
	cfg.requests = nil

	auth := &httprequest.AuthConfig{OAuth2: &httprequest.OAuth2Config{ //nolint:gosec // TokenURL below is a fixture URL, not a credential (G101 false positive)
		GrantType: "client_credentials", TokenURL: "https://auth.example.com/token", ClientID: "client-1", Scope: "read",
	}}
	req, err := cfg.CreateHTTPRequest("OAuth2 API", "https://example.com", "", "", httprequest.AuthOAuth2, nil, "", auth, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}
	if req.Auth == nil || req.Auth.OAuth2 == nil || req.Auth.OAuth2.ClientID != "client-1" {
		t.Fatalf("CreateHTTPRequest returned Auth = %+v, want the OAuth2Config passed in", req.Auth)
	}
	if err := cfg.SetHTTPRequestSecret(req.ID, "client-secret"); err != nil {
		t.Fatalf("SetHTTPRequestSecret returned error: %v", err)
	}

	restarted := NewConfigureService(store, comp, credential.New())
	// Find by ID -- top-up seeding appends built-in examples alongside
	// user data, so list-shape assertions no longer hold.
	restored, found := findRequestByID(restarted.HTTPRequests(), req.ID)
	if !found || restored.Auth == nil || restored.Auth.OAuth2 == nil {
		t.Fatalf("request %s after restore = %+v (found=%v), want Auth to survive persist/restore", req.ID, restored, found)
	}
	if restored.Auth.OAuth2.TokenURL != "https://auth.example.com/token" || restored.Auth.OAuth2.Scope != "read" {
		t.Errorf("restored Auth.OAuth2 = %+v, want the original TokenURL/Scope", restored.Auth.OAuth2)
	}

	rc, err := restarted.resolveHTTPRequest(req.ID)
	if err != nil {
		t.Fatalf("resolveHTTPRequest after restore returned error: %v", err)
	}
	if rc.Auth == nil || rc.Auth.OAuth2 == nil || rc.Auth.OAuth2.ClientID != "client-1" {
		t.Errorf("resolveHTTPRequest Auth = %+v, want it threaded through to ResolvedHTTPRequest", rc.Auth)
	}
}

// TestUpdateHTTPRequest_AuthConfig_Replaces proves UpdateHTTPRequest's new
// Auth param actually replaces the stored config, not just accepted
// and discarded.
func TestUpdateHTTPRequest_AuthConfig_Replaces(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest("HMAC API", "https://example.com", "", "", httprequest.AuthHMAC, nil, "", &httprequest.AuthConfig{HMAC: &httprequest.HMACConfig{HeaderName: "X-Sig"}}, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}

	updated, err := cfg.UpdateHTTPRequest(req.ID, "HMAC API", "https://example.com", "", "", httprequest.AuthHMAC, nil, "", &httprequest.AuthConfig{HMAC: &httprequest.HMACConfig{HeaderName: "X-Custom-Sig"}}, nil, "")
	if err != nil {
		t.Fatalf("UpdateHTTPRequest returned error: %v", err)
	}
	if updated.Auth == nil || updated.Auth.HMAC == nil || updated.Auth.HMAC.HeaderName != "X-Custom-Sig" {
		t.Errorf("UpdateHTTPRequest Auth = %+v, want the replaced HMACConfig", updated.Auth)
	}
}

// TestSetHTTPRequestOAuth1Secret_EncodesDualSecret proves the OAuth1
// dual-secret convenience method (ADR-0015 §3) stores a value
// resolveHTTPRequest can hand back to composition.ApplyAuth's OAuth1
// strategy -- decoding is composition's own concern
// (decodeOAuth1Secret, unexported), so this only checks the round trip
// through resolveHTTPRequest's Secret field, not the decoded shape.
func TestSetHTTPRequestOAuth1Secret_EncodesDualSecret(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest("OAuth1 API", "https://example.com", "", "", httprequest.AuthOAuth1, nil, "", &httprequest.AuthConfig{OAuth1: &httprequest.OAuth1Config{ConsumerKey: "ck-1", Token: "tok-1"}}, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}
	if err := cfg.SetHTTPRequestOAuth1Secret(req.ID, "consumer-secret", "token-secret"); err != nil {
		t.Fatalf("SetHTTPRequestOAuth1Secret returned error: %v", err)
	}

	rc, err := cfg.resolveHTTPRequest(req.ID)
	if err != nil {
		t.Fatalf("resolveHTTPRequest returned error: %v", err)
	}
	if rc.Secret == "" {
		t.Fatal("resolveHTTPRequest Secret is empty, want the encoded OAuth1 dual secret")
	}
	if got := composition.EncodeOAuth1Secret("consumer-secret", "token-secret"); rc.Secret != got {
		t.Errorf("resolveHTTPRequest Secret = %q, want %q (composition.EncodeOAuth1Secret's own encoding)", rc.Secret, got)
	}
}

func TestSetHTTPRequestOAuth1Secret_UnknownHTTPRequest_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if err := cfg.SetHTTPRequestOAuth1Secret("does-not-exist", "cs", "ts"); err == nil {
		t.Fatal("SetHTTPRequestOAuth1Secret for an unknown request returned nil error, want an error")
	}
}

// TestCreateHTTPRequest_JOSEConfig_PersistsAndSurvivesRestore mirrors
// TestCreateHTTPRequest_AuthConfig_PersistsAndSurvivesRestore (ADR-0015
// Phase 2) for Phase 3's JOSE field -- a real persist/restore round
// trip via a second ConfigureService over the same fakeStore, not just
// that CreateHTTPRequest accepts the param.
func TestCreateHTTPRequest_JOSEConfig_PersistsAndSurvivesRestore(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := NewConfigureService(store, comp, credential.New())
	// Starts from an empty request list, not the seeded built-in
	// examples -- see newTestConfigureService's own doc comment
	// (configureservice_test.go) for why.
	cfg.requests = nil

	jose := &httprequest.JOSEConfig{Enabled: true, RecipientPublicKeyPEM: "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----"}
	req, err := cfg.CreateHTTPRequest("JOSE API", "https://example.com", "", "", httprequest.AuthNone, nil, "", nil, jose, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}
	if req.JOSE == nil || !req.JOSE.Enabled {
		t.Fatalf("CreateHTTPRequest returned JOSE = %+v, want the JOSEConfig passed in", req.JOSE)
	}

	restarted := NewConfigureService(store, comp, credential.New())
	restored, found := findRequestByID(restarted.HTTPRequests(), req.ID)
	if !found || restored.JOSE == nil || !restored.JOSE.Enabled {
		t.Fatalf("request %s after restore = %+v (found=%v), want JOSE to survive persist/restore", req.ID, restored, found)
	}
	if restored.JOSE.RecipientPublicKeyPEM != jose.RecipientPublicKeyPEM {
		t.Errorf("restored JOSE.RecipientPublicKeyPEM = %q, want %q", restored.JOSE.RecipientPublicKeyPEM, jose.RecipientPublicKeyPEM)
	}

	rc, err := restarted.resolveHTTPRequest(req.ID)
	if err != nil {
		t.Fatalf("resolveHTTPRequest after restore returned error: %v", err)
	}
	if rc.JOSE == nil || !rc.JOSE.Enabled {
		t.Errorf("resolveHTTPRequest JOSE = %+v, want it threaded through to ResolvedHTTPRequest", rc.JOSE)
	}
	// DecryptResponse is false on this request, so resolveHTTPRequest
	// must not have attempted a keychain fetch for a JOSE private key --
	// confirmed indirectly: no error above means it didn't try and fail.
	if rc.JOSEPrivateKeyPEM != "" {
		t.Errorf("resolveHTTPRequest JOSEPrivateKeyPEM = %q, want empty (DecryptResponse is false)", rc.JOSEPrivateKeyPEM)
	}
}

// TestSetHTTPRequestJOSEPrivateKey_ResolvesOnlyWhenDecryptResponseIsSet
// proves the private-key keychain fetch is conditional on
// JOSE.DecryptResponse, and that it's stored under a distinct keychain
// entry from the request's own AuthType secret (ADR-0015 Phase 3
// §"joseKeychainID") -- setting one never clobbers the other.
func TestSetHTTPRequestJOSEPrivateKey_ResolvesOnlyWhenDecryptResponseIsSet(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest(
		"JOSE+Bearer API", "https://example.com", "", "", httprequest.AuthBearer, nil, "", nil,
		&httprequest.JOSEConfig{Enabled: true, DecryptResponse: true, RecipientPublicKeyPEM: "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----"},
		"",
	)
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}
	if err := cfg.SetHTTPRequestSecret(req.ID, "bearer-token"); err != nil {
		t.Fatalf("SetHTTPRequestSecret returned error: %v", err)
	}
	if err := cfg.SetHTTPRequestJOSEPrivateKey(req.ID, "jose-private-key-pem"); err != nil {
		t.Fatalf("SetHTTPRequestJOSEPrivateKey returned error: %v", err)
	}

	rc, err := cfg.resolveHTTPRequest(req.ID)
	if err != nil {
		t.Fatalf("resolveHTTPRequest returned error: %v", err)
	}
	if rc.Secret != "bearer-token" {
		t.Errorf("resolveHTTPRequest Secret = %q, want the AuthType secret %q, unaffected by the JOSE key", rc.Secret, "bearer-token")
	}
	if rc.JOSEPrivateKeyPEM != "jose-private-key-pem" {
		t.Errorf("resolveHTTPRequest JOSEPrivateKeyPEM = %q, want %q", rc.JOSEPrivateKeyPEM, "jose-private-key-pem")
	}
}

func TestSetHTTPRequestJOSEPrivateKey_UnknownHTTPRequest_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if err := cfg.SetHTTPRequestJOSEPrivateKey("does-not-exist", "pem"); err == nil {
		t.Fatal("SetHTTPRequestJOSEPrivateKey for an unknown request returned nil error, want an error")
	}
}

func TestDeleteHTTPRequest_AlsoRemovesJOSEPrivateKey(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest(
		"JOSE API", "https://example.com", "", "", httprequest.AuthNone, nil, "", nil,
		&httprequest.JOSEConfig{Enabled: true, DecryptResponse: true, RecipientPublicKeyPEM: "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----"},
		"",
	)
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}
	if err := cfg.SetHTTPRequestJOSEPrivateKey(req.ID, "jose-private-key-pem"); err != nil {
		t.Fatalf("SetHTTPRequestJOSEPrivateKey returned error: %v", err)
	}
	if err := cfg.DeleteHTTPRequest(req.ID); err != nil {
		t.Fatalf("DeleteHTTPRequest returned error: %v", err)
	}
	if err := cfg.SetHTTPRequestJOSEPrivateKey(req.ID, "anything"); err == nil {
		t.Fatal("SetHTTPRequestJOSEPrivateKey on a deleted request returned nil error, want an error (request no longer exists)")
	}
}
