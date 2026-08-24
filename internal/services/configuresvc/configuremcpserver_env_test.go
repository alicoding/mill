package configuresvc

import (
	"errors"
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
