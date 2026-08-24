package configuresvc

import (
	"errors"
	"strings"
	"testing"
)

// TestResolveMCPServer_VaultRefResolved proves an MCPServer.Env entry
// shaped "KEY=vault:<id>" resolves to the real secret via
// SetSecretResolver -- goal 0185 S3's own resolution seam.
func TestResolveMCPServer_VaultRefResolved(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	cfg.SetSecretResolver(func(id string) (string, error) {
		if id == "entry-1" {
			return "real-secret-fake", nil
		}
		return "", errors.New("unexpected id")
	})

	s, err := cfg.CreateMCPServer("GitHub", "github-mcp-server", nil, []string{"GITHUB_TOKEN=vault:entry-1", "OTHER=plain-value"})
	if err != nil {
		t.Fatalf("CreateMCPServer: %v", err)
	}

	rs, err := cfg.resolveMCPServer(s.ID)
	if err != nil {
		t.Fatalf("resolveMCPServer: %v", err)
	}
	want := []string{"GITHUB_TOKEN=real-secret-fake", "OTHER=plain-value"}
	if len(rs.Env) != len(want) || rs.Env[0] != want[0] || rs.Env[1] != want[1] {
		t.Fatalf("resolveMCPServer Env = %v, want %v", rs.Env, want)
	}
}

// TestResolveMCPServer_VaultLocked_FailsExplicitly pins the goal
// file's own requirement: a workflow resolving a vault-ref secret
// during a locked window fails with an explicit error, never a
// silent empty/wrong value.
func TestResolveMCPServer_VaultLocked_FailsExplicitly(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	lockedErr := errors.New("secretvault: vault is locked")
	cfg.SetSecretResolver(func(string) (string, error) { return "", lockedErr })

	s, err := cfg.CreateMCPServer("GitHub", "github-mcp-server", nil, []string{"GITHUB_TOKEN=vault:entry-1"})
	if err != nil {
		t.Fatalf("CreateMCPServer: %v", err)
	}
	if _, err := cfg.resolveMCPServer(s.ID); err == nil {
		t.Fatal("resolveMCPServer with a locked vault returned nil error, want an error")
	}
}

// TestExportMCPServer_NeverCarriesResolvedSecret proves goal 0185's own
// acceptance bar ("a secret's value is unreachable from export") for
// MCPServer specifically: a vault-ref Env entry exports as its literal
// "vault:<id>" reference, never the real resolved secret -- even
// though resolveMCPServer (the spawn-time path) DOES resolve it, the
// resolver is deliberately never consulted on the export path at all.
func TestExportMCPServer_NeverCarriesResolvedSecret(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	cfg.SetSecretResolver(func(string) (string, error) {
		return "real-secret-fake", nil
	})

	s, err := cfg.CreateMCPServer("GitHub", "github-mcp-server", nil, []string{"GITHUB_TOKEN=vault:entry-1"})
	if err != nil {
		t.Fatalf("CreateMCPServer: %v", err)
	}

	exported, err := cfg.ExportMCPServer(s.ID)
	if err != nil {
		t.Fatalf("ExportMCPServer: %v", err)
	}
	if strings.Contains(exported, "real-secret-fake") {
		t.Fatalf("ExportMCPServer output contains the resolved secret: %s", exported)
	}
	if !strings.Contains(exported, "vault:entry-1") {
		t.Fatalf("ExportMCPServer output = %s, want it to still carry the vault reference", exported)
	}
}

// TestResolveMCPServer_NoEnv_Unaffected proves the additive-migration
// property: an MCPServer with no Env at all resolves exactly as before
// this feature existed -- the secret resolver is never even called.
func TestResolveMCPServer_NoEnv_Unaffected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	cfg.SetSecretResolver(func(string) (string, error) {
		t.Fatal("secret resolver called for an MCPServer with no Env")
		return "", nil
	})

	s, err := cfg.CreateMCPServer("Plain server", "some-command", nil, nil)
	if err != nil {
		t.Fatalf("CreateMCPServer: %v", err)
	}
	rs, err := cfg.resolveMCPServer(s.ID)
	if err != nil {
		t.Fatalf("resolveMCPServer: %v", err)
	}
	if len(rs.Env) != 0 {
		t.Fatalf("resolveMCPServer Env = %v, want empty", rs.Env)
	}
}
