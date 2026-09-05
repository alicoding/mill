package configuresvc

import (
	"errors"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/httprequest"
)

// HTTPRequest.Headers vault-reference resolution tests (goal 0203 S1) --
// split into their own file rather than appended to
// configureservice_requestauth_test.go, which was already close to
// CLAUDE.md's 500-line file convention.

// TestResolveHTTPRequest_HeaderVaultRefResolved proves a custom Headers
// entry shaped "vault:<id>" resolves to the real secret via
// SetSecretResolver, the same resolution contract
// resolveMCPServer/resolveExecEnv already prove for their own
// KEY=VALUE Env fields -- an HTTP connector step is a non-MCP consumer
// of a stored credential (0203's own named gap: "an HTTP connector step
// cannot use a stored credential at all").
func TestResolveHTTPRequest_HeaderVaultRefResolved(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	cfg.SetSecretResolver(func(id string, _ secretaudit.AccessContext) (string, error) {
		if id == "entry-1" {
			return "real-secret-fake", nil
		}
		return "", errors.New("unexpected id")
	})

	req, err := cfg.CreateHTTPRequest("Secured API", "https://example.com", "", "", httprequest.AuthNone, "",
		map[string]string{"X-Api-Key": "vault:entry-1", "Accept": "application/json"}, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}

	rc, err := cfg.resolveHTTPRequest(req.ID, composition.SecretAccessRun{})
	if err != nil {
		t.Fatalf("resolveHTTPRequest: %v", err)
	}
	if rc.Headers["X-Api-Key"] != "real-secret-fake" {
		t.Errorf("resolveHTTPRequest Headers[X-Api-Key] = %q, want %q", rc.Headers["X-Api-Key"], "real-secret-fake")
	}
	if rc.Headers["Accept"] != "application/json" {
		t.Errorf("resolveHTTPRequest Headers[Accept] = %q, want %q (plain values pass through unchanged)", rc.Headers["Accept"], "application/json")
	}
}

// TestResolveHTTPRequest_HeaderVaultLocked_FailsExplicitly mirrors the
// MCP/ExecEnv locked-vault cases: a resolution failure during a locked
// window surfaces explicitly, never a silent empty/wrong header value.
func TestResolveHTTPRequest_HeaderVaultLocked_FailsExplicitly(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	lockedErr := errors.New("secretvault: vault is locked")
	cfg.SetSecretResolver(func(string, secretaudit.AccessContext) (string, error) { return "", lockedErr })

	req, err := cfg.CreateHTTPRequest("Secured API", "https://example.com", "", "", httprequest.AuthNone, "",
		map[string]string{"X-Api-Key": "vault:entry-1"}, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	if _, err := cfg.resolveHTTPRequest(req.ID, composition.SecretAccessRun{}); err == nil {
		t.Fatal("resolveHTTPRequest with a locked vault returned nil error, want an error")
	}
}

// TestExportHTTPRequest_NeverCarriesResolvedHeaderSecret mirrors
// TestExportMCPServer_NeverCarriesResolvedSecret: a vault-ref header
// exports as its literal "vault:<id>" reference, never the real
// resolved secret -- export never consults the secret resolver.
func TestExportHTTPRequest_NeverCarriesResolvedHeaderSecret(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	cfg.SetSecretResolver(func(string, secretaudit.AccessContext) (string, error) {
		return "real-secret-fake", nil
	})

	req, err := cfg.CreateHTTPRequest("Secured API", "https://example.com", "", "", httprequest.AuthNone, "",
		map[string]string{"X-Api-Key": "vault:entry-1"}, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}

	exported, err := cfg.ExportHTTPRequest(req.ID)
	if err != nil {
		t.Fatalf("ExportHTTPRequest: %v", err)
	}
	if strings.Contains(exported, "real-secret-fake") {
		t.Fatalf("ExportHTTPRequest output contains the resolved secret: %s", exported)
	}
	if !strings.Contains(exported, "vault:entry-1") {
		t.Fatalf("ExportHTTPRequest output = %s, want it to still carry the vault reference", exported)
	}
}

// TestResolveHTTPRequest_NoHeaders_Unaffected proves the additive-
// migration property: a request with no custom Headers at all resolves
// exactly as before this feature existed -- the secret resolver is
// never even called for headers.
func TestResolveHTTPRequest_NoHeaders_Unaffected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	cfg.SetSecretResolver(func(string, secretaudit.AccessContext) (string, error) {
		t.Fatal("secret resolver called for a request with no Headers")
		return "", nil
	})

	req, err := cfg.CreateHTTPRequest("Public API", "https://example.com", "", "", httprequest.AuthNone, "", nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	rc, err := cfg.resolveHTTPRequest(req.ID, composition.SecretAccessRun{})
	if err != nil {
		t.Fatalf("resolveHTTPRequest: %v", err)
	}
	if len(rc.Headers) != 0 {
		t.Fatalf("resolveHTTPRequest Headers = %v, want empty", rc.Headers)
	}
}
