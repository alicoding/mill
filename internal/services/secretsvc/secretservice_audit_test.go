package secretsvc

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/adapters/secretauditstore"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// Goal 0203 S3: every secret read leaves an audit line. newAuditedTestService
// mirrors newTestService but also opens the audit store (a real
// secretauditstore.Store at a temp file, never a stub) -- the seams
// under test (ResolveSecretValue/RevealSecret/CopySecretToClipboard)
// write through s.recordAccess exactly the way production does.
func newAuditedTestService(t *testing.T) *SecretService {
	t.Helper()
	dir := t.TempDir()
	s := NewSecretService(secretvault.New(filepath.Join(dir, "secrets.kdbx")), credential.NewInMemory(), servicetest.NewFakeStore())
	t.Cleanup(s.StopAutoLock)
	if err := s.OpenAudit(filepath.Join(dir, "execution.db"), nil); err != nil {
		t.Fatalf("OpenAudit: %v", err)
	}
	t.Cleanup(func() { _ = s.CloseAudit() })
	return s
}

// secretauditFilter is the empty (no-filter) Filter every test in this
// file lists with -- named for readability at each call site.
func secretauditFilter() secretauditstore.Filter { return secretauditstore.Filter{} }

func TestRevealSecret_RecordsUIRevealAuditLine(t *testing.T) {
	s := newAuditedTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	created, err := s.CreateSecret("API", "", "reveal-pw-fake", "", "", nil, "", "", nil)
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}

	if _, err := s.RevealSecret(created.ID); err != nil {
		t.Fatalf("RevealSecret: %v", err)
	}

	records, total, err := s.auditStore.List(secretauditFilter(), 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 1 || len(records) != 1 {
		t.Fatalf("audit rows = %d, want exactly 1: %+v", total, records)
	}
	rec := records[0]
	if rec.Context != secretaudit.ContextUIReveal {
		t.Errorf("Context = %q, want %q", rec.Context, secretaudit.ContextUIReveal)
	}
	if rec.EntryID != created.ID || rec.Label != "API" {
		t.Errorf("EntryID/Label = %q/%q, want %q/API", rec.EntryID, rec.Label, created.ID)
	}
	if rec.Outcome != secretaudit.OutcomeRead {
		t.Errorf("Outcome = %q, want read", rec.Outcome)
	}
	if time.Since(rec.Timestamp) > time.Minute {
		t.Errorf("Timestamp = %v, want roughly now", rec.Timestamp)
	}
}

func TestCopySecretToClipboard_RecordsUICopyAuditLine(t *testing.T) {
	s := newAuditedTestService(t)
	fc := &fakeClipboard{}
	origWrite, origRead := clipboardWriteFn, clipboardReadFn
	clipboardWriteFn, clipboardReadFn = fc.write, fc.read
	t.Cleanup(func() { clipboardWriteFn, clipboardReadFn = origWrite, origRead })

	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	created, err := s.CreateSecret("API", "", "copy-pw-fake", "", "", nil, "", "", nil)
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}

	if err := s.CopySecretToClipboard(created.ID); err != nil {
		t.Fatalf("CopySecretToClipboard: %v", err)
	}

	records, total, err := s.auditStore.List(secretauditFilter(), 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 1 || len(records) != 1 {
		t.Fatalf("audit rows = %d, want exactly 1: %+v", total, records)
	}
	if records[0].Context != secretaudit.ContextUICopy {
		t.Errorf("Context = %q, want %q", records[0].Context, secretaudit.ContextUICopy)
	}
}

// TestResolveSecretValue_ErrorOutcome_RecordsAnErrorAuditLine proves a
// FAILED resolution (an unknown id, standing in for any Get error) still
// leaves a line -- "what tried to read this and couldn't" is exactly as
// answerable as a successful read.
func TestResolveSecretValue_ErrorOutcome_RecordsAnErrorAuditLine(t *testing.T) {
	s := newAuditedTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}

	if _, err := s.ResolveSecretValue("does-not-exist", secretaudit.AccessContext{Context: secretaudit.ContextExecEnv}); err == nil {
		t.Fatal("ResolveSecretValue for an unknown id returned nil error, want an error")
	}

	records, total, err := s.auditStore.List(secretauditFilter(), 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 1 || len(records) != 1 {
		t.Fatalf("audit rows = %d, want exactly 1: %+v", total, records)
	}
	rec := records[0]
	if rec.Outcome != secretaudit.OutcomeError {
		t.Errorf("Outcome = %q, want error", rec.Outcome)
	}
	if rec.ErrorText == "" {
		t.Error("ErrorText is empty, want the resolution failure's own message")
	}
}

// TestRedactKnownSecrets_NeverAudited pins the goal file's own
// deliberate opt-out: scrubbing an error message enumerates the whole
// vault but must never leave an audit line.
func TestRedactKnownSecrets_NeverAudited(t *testing.T) {
	s := newAuditedTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	if _, err := s.CreateSecret("API", "", "redact-pw-fake", "", "", nil, "", "", nil); err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}

	got := s.RedactKnownSecrets("the token redact-pw-fake leaked")
	if got == "the token redact-pw-fake leaked" {
		t.Fatal("RedactKnownSecrets left the known secret value in the text")
	}

	_, total, err := s.auditStore.List(secretauditFilter(), 10, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 0 {
		t.Fatalf("audit rows after RedactKnownSecrets = %d, want 0", total)
	}
}

// TestListSecretAccess_GlobalAndPerEntry proves the bound read API the
// Secrets view calls: an empty EntryID lists every entry's rows
// newest-first (the global Access history list); a set EntryID filters
// to just that entry's own rows (the detail dialog's own filtered
// view) -- the same global-vs-filtered contract ListMCPCalls already
// establishes for MCP calls.
func TestListSecretAccess_GlobalAndPerEntry(t *testing.T) {
	s := newAuditedTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	a, err := s.CreateSecret("GitHub PAT", "", "gh-fake", "", "", nil, "", "", nil)
	if err != nil {
		t.Fatalf("CreateSecret a: %v", err)
	}
	b, err := s.CreateSecret("Bank Token", "", "bank-fake", "", "", nil, "", "", nil)
	if err != nil {
		t.Fatalf("CreateSecret b: %v", err)
	}
	if _, err := s.RevealSecret(a.ID); err != nil {
		t.Fatalf("RevealSecret a: %v", err)
	}
	if _, err := s.RevealSecret(b.ID); err != nil {
		t.Fatalf("RevealSecret b: %v", err)
	}
	if _, err := s.RevealSecret(a.ID); err != nil {
		t.Fatalf("RevealSecret a (again): %v", err)
	}

	all, err := s.ListSecretAccess(ListSecretAccessRequest{})
	if err != nil {
		t.Fatalf("ListSecretAccess (global): %v", err)
	}
	if all.Total != 3 || len(all.Records) != 3 {
		t.Fatalf("global: total=%d len=%d, want 3/3", all.Total, len(all.Records))
	}

	filtered, err := s.ListSecretAccess(ListSecretAccessRequest{EntryID: a.ID})
	if err != nil {
		t.Fatalf("ListSecretAccess (filtered): %v", err)
	}
	if filtered.Total != 2 || len(filtered.Records) != 2 {
		t.Fatalf("filtered to entry a: total=%d len=%d, want 2/2", filtered.Total, len(filtered.Records))
	}
	for _, r := range filtered.Records {
		if r.EntryID != a.ID {
			t.Fatalf("filtered result contains a row for entry %q, want only %q", r.EntryID, a.ID)
		}
		if r.Context != string(secretaudit.ContextUIReveal) {
			t.Errorf("Context = %q, want %q", r.Context, secretaudit.ContextUIReveal)
		}
	}
}

// TestListSecretAccess_NoAuditStoreWired_ReturnsEmptyNotError proves the
// graceful-degradation path: a SecretService that never had OpenAudit
// called (every test that uses newTestService instead of
// newAuditedTestService) answers an empty page, never an error.
func TestListSecretAccess_NoAuditStoreWired_ReturnsEmptyNotError(t *testing.T) {
	s := newTestService(t)
	resp, err := s.ListSecretAccess(ListSecretAccessRequest{})
	if err != nil {
		t.Fatalf("ListSecretAccess with no audit store wired returned an error: %v", err)
	}
	if resp.Total != 0 || len(resp.Records) != 0 {
		t.Fatalf("resp = %+v, want empty", resp)
	}
}
