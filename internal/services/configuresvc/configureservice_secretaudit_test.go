package configuresvc

import (
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/adapters/secretauditstore"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/execenv"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/services/secretsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// Goal 0203 S3: service-level proof that each instrumented vault-
// resolution seam emits exactly one secretaudit.Record with the right
// context, driven through the REAL composed path -- a real
// secretsvc.SecretService wired via SetSecretResolver, the exact seam
// wiring.WireSecrets uses in production, never a stub resolver.

// newAuditedSecretService wires cfg's own secretResolver to a real
// secretsvc.SecretService with its audit store opened at a temp file,
// and returns a second, independent connection to that same file
// (secretauditstore itself is built for concurrent readers/writers on
// one sqlite file, same pattern mcpauditstore already establishes) so
// the test can assert on rows without reaching into secretsvc's own
// unexported fields.
func newAuditedSecretService(t *testing.T, cfg *ConfigureService) (*secretsvc.SecretService, *secretauditstore.Store) {
	t.Helper()
	dir := t.TempDir()
	secretService := secretsvc.NewSecretService(secretvault.New(filepath.Join(dir, "secrets.kdbx")), credential.NewInMemory(), servicetest.NewFakeStore())
	t.Cleanup(secretService.StopAutoLock)
	if err := secretService.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	dbPath := filepath.Join(dir, "execution.db")
	if err := secretService.OpenAudit(dbPath, nil); err != nil {
		t.Fatalf("OpenAudit: %v", err)
	}
	t.Cleanup(func() { _ = secretService.CloseAudit() })
	cfg.SetSecretResolver(secretService.ResolveSecretValue)

	auditStore, err := secretauditstore.Open(dbPath)
	if err != nil {
		t.Fatalf("open audit store for assertions: %v", err)
	}
	t.Cleanup(func() { _ = auditStore.Close() })
	return secretService, auditStore
}

// onlyRecord asserts store holds exactly one row (the demo entry
// SetupVault seeds is never itself read, so a fresh store starts empty)
// and returns it.
func onlyRecord(t *testing.T, store *secretauditstore.Store) secretaudit.Record {
	t.Helper()
	records, total, err := store.List(secretauditstore.Filter{}, 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 1 || len(records) != 1 {
		t.Fatalf("audit rows = %d, want exactly 1: %+v", total, records)
	}
	return records[0]
}

func TestResolveMCPServer_RealRun_RecordsOneMCPServerSpawnAuditLine(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	secretService, auditStore := newAuditedSecretService(t, cfg)
	created, err := secretService.CreateSecret("GitHub PAT", "", "gh-token-fake", "", "", "")
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	s, err := cfg.CreateMCPServer("GitHub", "github-mcp-server", nil, []string{"GITHUB_TOKEN=vault:" + created.ID})
	if err != nil {
		t.Fatalf("CreateMCPServer: %v", err)
	}

	if _, err := cfg.resolveMCPServer(s.ID, composition.SecretAccessRun{RunID: "run-1", WorkflowID: "wf-1"}); err != nil {
		t.Fatalf("resolveMCPServer: %v", err)
	}

	rec := onlyRecord(t, auditStore)
	if rec.Context != secretaudit.ContextMCPServerSpawn {
		t.Errorf("Context = %q, want %q", rec.Context, secretaudit.ContextMCPServerSpawn)
	}
	if rec.EntryID != created.ID || rec.Label != "GitHub PAT" {
		t.Errorf("EntryID/Label = %q/%q, want %q/GitHub PAT", rec.EntryID, rec.Label, created.ID)
	}
	if rec.RunID != "run-1" || rec.WorkflowID != "wf-1" {
		t.Errorf("RunID/WorkflowID = %q/%q, want run-1/wf-1", rec.RunID, rec.WorkflowID)
	}
	if rec.Outcome != secretaudit.OutcomeRead {
		t.Errorf("Outcome = %q, want read", rec.Outcome)
	}
}

// TestListMCPServerTools_PreviewResolution_RecordsConfigureToolsPreviewContext
// proves S2's own found gap (ListMCPServerTools resolves a vault-
// referenced MCP server's env outside any workflow run) now carries an
// audit line -- this is that finding's recorded home (goal 0203 S3
// contract). Exercises resolveMCPServerWithAccess directly:
// ListMCPServerTools' own subprocess-spawning tail is untestable at
// this layer, same reasoning TestListMCPServerTools_UnknownID_Rejected's
// doc comment already gives for this package's tests.
func TestListMCPServerTools_PreviewResolution_RecordsConfigureToolsPreviewContext(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	secretService, auditStore := newAuditedSecretService(t, cfg)
	created, err := secretService.CreateSecret("GitHub PAT", "", "gh-token-fake", "", "", "")
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	s, err := cfg.CreateMCPServer("GitHub", "github-mcp-server", nil, []string{"GITHUB_TOKEN=vault:" + created.ID})
	if err != nil {
		t.Fatalf("CreateMCPServer: %v", err)
	}

	if _, err := cfg.resolveMCPServerWithAccess(s.ID, secretaudit.AccessContext{Context: secretaudit.ContextConfigureToolsPreview}); err != nil {
		t.Fatalf("resolveMCPServerWithAccess: %v", err)
	}

	rec := onlyRecord(t, auditStore)
	if rec.Context != secretaudit.ContextConfigureToolsPreview {
		t.Errorf("Context = %q, want %q", rec.Context, secretaudit.ContextConfigureToolsPreview)
	}
	if rec.RunID != "" || rec.WorkflowID != "" {
		t.Errorf("RunID/WorkflowID = %q/%q, want empty (a preview, not a run)", rec.RunID, rec.WorkflowID)
	}
}

func TestResolveExecEnv_RealRun_RecordsOneExecEnvAuditLine(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	secretService, auditStore := newAuditedSecretService(t, cfg)
	created, err := secretService.CreateSecret("DB Password", "", "db-pw-fake", "", "", "")
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	e, err := cfg.CreateExecEnv("Sandbox", execenv.ShellSh, execenv.ProfileClean, execenv.TempDirSentinel, []string{"DB_PW=vault:" + created.ID})
	if err != nil {
		t.Fatalf("CreateExecEnv: %v", err)
	}

	if _, err := cfg.resolveExecEnv(e.ID, composition.SecretAccessRun{RunID: "run-2", WorkflowID: "wf-2"}); err != nil {
		t.Fatalf("resolveExecEnv: %v", err)
	}

	rec := onlyRecord(t, auditStore)
	if rec.Context != secretaudit.ContextExecEnv {
		t.Errorf("Context = %q, want %q", rec.Context, secretaudit.ContextExecEnv)
	}
	if rec.RunID != "run-2" || rec.WorkflowID != "wf-2" {
		t.Errorf("RunID/WorkflowID = %q/%q, want run-2/wf-2", rec.RunID, rec.WorkflowID)
	}
}

func TestResolveHTTPRequest_RealRun_RecordsOneHTTPHeaderAuditLine(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	secretService, auditStore := newAuditedSecretService(t, cfg)
	created, err := secretService.CreateSecret("Webhook signing key", "", "sig-key-fake", "", "", "")
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	req, err := cfg.CreateHTTPRequest("Webhook", "https://example.com", "POST", "", httprequest.AuthNone,
		map[string]string{"X-Signature": "vault:" + created.ID}, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}

	if _, err := cfg.resolveHTTPRequest(req.ID, composition.SecretAccessRun{RunID: "run-3", WorkflowID: "wf-3"}); err != nil {
		t.Fatalf("resolveHTTPRequest: %v", err)
	}

	rec := onlyRecord(t, auditStore)
	if rec.Context != secretaudit.ContextHTTPHeader {
		t.Errorf("Context = %q, want %q", rec.Context, secretaudit.ContextHTTPHeader)
	}
	if rec.RunID != "run-3" || rec.WorkflowID != "wf-3" {
		t.Errorf("RunID/WorkflowID = %q/%q, want run-3/wf-3", rec.RunID, rec.WorkflowID)
	}
}

// TestResolveVaultRefEnv_PlainValue_NeverCallsSecretResolver proves the
// negative: a field with no "vault:" reference at all resolves without
// ever reaching the audit-writing seam, so plain env/header values never
// pollute Access history.
func TestResolveVaultRefEnv_PlainValue_NeverAudited(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	_, auditStore := newAuditedSecretService(t, cfg)

	s, err := cfg.CreateMCPServer("Plain", "some-command", nil, []string{"PLAIN=value"})
	if err != nil {
		t.Fatalf("CreateMCPServer: %v", err)
	}
	if _, err := cfg.resolveMCPServer(s.ID, composition.SecretAccessRun{}); err != nil {
		t.Fatalf("resolveMCPServer: %v", err)
	}

	_, total, err := auditStore.List(secretauditstore.Filter{}, 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 0 {
		t.Fatalf("audit rows = %d, want 0 for a server with no vault: reference", total)
	}
}
