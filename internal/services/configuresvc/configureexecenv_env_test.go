package configuresvc

import (
	"errors"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/execenv"
)

// TestResolveExecEnv_VaultRefResolved proves an ExecEnv.Env entry
// shaped "KEY=vault:<id>" resolves to the real secret via
// SetSecretResolver, through the same resolveVaultRefEnv path
// resolveMCPServer already proves (goal 0203 S1 -- a code-execution
// node is a non-MCP consumer of a stored credential).
func TestResolveExecEnv_VaultRefResolved(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	cfg.SetSecretResolver(func(id string, _ secretaudit.AccessContext) (string, error) {
		if id == "entry-1" {
			return "real-secret-fake", nil
		}
		return "", errors.New("unexpected id")
	})

	e, err := cfg.CreateExecEnv("Sandbox", execenv.ShellSh, execenv.ProfileClean, execenv.TempDirSentinel, []string{"API_KEY=vault:entry-1", "OTHER=plain-value"})
	if err != nil {
		t.Fatalf("CreateExecEnv: %v", err)
	}

	rs, err := cfg.resolveExecEnv(e.ID, composition.SecretAccessRun{})
	if err != nil {
		t.Fatalf("resolveExecEnv: %v", err)
	}
	want := []string{"API_KEY=real-secret-fake", "OTHER=plain-value"}
	if len(rs.Env) != len(want) || rs.Env[0] != want[0] || rs.Env[1] != want[1] {
		t.Fatalf("resolveExecEnv Env = %v, want %v", rs.Env, want)
	}
}

// TestResolveExecEnv_VaultLocked_FailsExplicitly mirrors
// TestResolveMCPServer_VaultLocked_FailsExplicitly for ExecEnv: a
// locked-vault resolution failure surfaces explicitly, never a silent
// empty/wrong value.
func TestResolveExecEnv_VaultLocked_FailsExplicitly(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	lockedErr := errors.New("secretvault: vault is locked")
	cfg.SetSecretResolver(func(string, secretaudit.AccessContext) (string, error) { return "", lockedErr })

	e, err := cfg.CreateExecEnv("Sandbox", execenv.ShellSh, execenv.ProfileClean, execenv.TempDirSentinel, []string{"API_KEY=vault:entry-1"})
	if err != nil {
		t.Fatalf("CreateExecEnv: %v", err)
	}
	if _, err := cfg.resolveExecEnv(e.ID, composition.SecretAccessRun{}); err == nil {
		t.Fatal("resolveExecEnv with a locked vault returned nil error, want an error")
	}
}

// TestExportExecEnv_NeverCarriesResolvedSecret mirrors
// TestExportMCPServer_NeverCarriesResolvedSecret: a vault-ref Env entry
// exports as its literal "vault:<id>" reference, never the real
// resolved secret -- export never consults the secret resolver at all.
func TestExportExecEnv_NeverCarriesResolvedSecret(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	cfg.SetSecretResolver(func(string, secretaudit.AccessContext) (string, error) {
		return "real-secret-fake", nil
	})

	e, err := cfg.CreateExecEnv("Sandbox", execenv.ShellSh, execenv.ProfileClean, execenv.TempDirSentinel, []string{"API_KEY=vault:entry-1"})
	if err != nil {
		t.Fatalf("CreateExecEnv: %v", err)
	}

	exported, err := cfg.ExportExecEnv(e.ID)
	if err != nil {
		t.Fatalf("ExportExecEnv: %v", err)
	}
	if strings.Contains(exported, "real-secret-fake") {
		t.Fatalf("ExportExecEnv output contains the resolved secret: %s", exported)
	}
	if !strings.Contains(exported, "vault:entry-1") {
		t.Fatalf("ExportExecEnv output = %s, want it to still carry the vault reference", exported)
	}
}

// TestResolveExecEnv_NoEnv_Unaffected mirrors
// TestResolveMCPServer_NoEnv_Unaffected: an ExecEnv with no Env at all
// resolves exactly as before this feature existed -- the secret
// resolver is never even called.
func TestResolveExecEnv_NoEnv_Unaffected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	cfg.SetSecretResolver(func(string, secretaudit.AccessContext) (string, error) {
		t.Fatal("secret resolver called for an ExecEnv with no Env")
		return "", nil
	})

	e, err := cfg.CreateExecEnv("Plain env", execenv.ShellSh, execenv.ProfileClean, execenv.TempDirSentinel, nil)
	if err != nil {
		t.Fatalf("CreateExecEnv: %v", err)
	}
	rs, err := cfg.resolveExecEnv(e.ID, composition.SecretAccessRun{})
	if err != nil {
		t.Fatalf("resolveExecEnv: %v", err)
	}
	if len(rs.Env) != 0 {
		t.Fatalf("resolveExecEnv Env = %v, want empty", rs.Env)
	}
}
