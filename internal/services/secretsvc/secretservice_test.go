package secretsvc

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// fakeClipboard backs clipboardWriteFn/clipboardReadFn in tests --
// mutex-guarded because CopySecretToClipboard's auto-clear runs its
// read+write on a separate goroutine (time.AfterFunc) from the test's
// own polling goroutine.
type fakeClipboard struct {
	mu  sync.Mutex
	val string
}

func (f *fakeClipboard) write(text string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.val = text
	return nil
}

func (f *fakeClipboard) read() (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.val, nil
}

func (f *fakeClipboard) get() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.val
}

func (f *fakeClipboard) set(v string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.val = v
}

func newTestService(t *testing.T) *SecretService {
	t.Helper()
	path := t.TempDir() + "/secrets.kdbx"
	s := NewSecretService(secretvault.New(path), credential.NewInMemory(), servicetest.NewFakeStore())
	t.Cleanup(s.StopAutoLock)
	return s
}

func TestSetupThenUnlockThenLock(t *testing.T) {
	s := newTestService(t)

	status := s.VaultStatus()
	if status.Exists || status.Unlocked {
		t.Fatalf("initial status = %+v, want both false", status)
	}

	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	status = s.VaultStatus()
	if !status.Exists || !status.Unlocked {
		t.Fatalf("status after SetupVault = %+v, want both true", status)
	}

	// The demo entry seeds one row (secret.BuiltInDemo).
	list, err := s.ListSecrets()
	if err != nil {
		t.Fatalf("ListSecrets: %v", err)
	}
	if len(list) != 1 || list[0].Title != "Example Login" {
		t.Fatalf("seeded list = %+v", list)
	}

	s.LockVault()
	if s.VaultStatus().Unlocked {
		t.Fatal("still unlocked after LockVault")
	}
	if _, err := s.ListSecrets(); err == nil {
		t.Fatal("ListSecrets should fail while locked")
	}

	if err := s.UnlockVault(); err != nil {
		t.Fatalf("UnlockVault: %v", err)
	}
	if !s.VaultStatus().Unlocked {
		t.Fatal("not unlocked after UnlockVault")
	}
}

func TestUnlockVault_NoVaultYet(t *testing.T) {
	s := newTestService(t)
	if err := s.UnlockVault(); !errors.Is(err, ErrNoVault) {
		t.Fatalf("UnlockVault with no vault = %v, want ErrNoVault", err)
	}
}

func TestUnlockVault_KeyMissingFromKeychain(t *testing.T) {
	path := t.TempDir() + "/secrets.kdbx"
	creds := credential.NewInMemory()
	s := NewSecretService(secretvault.New(path), creds, servicetest.NewFakeStore())
	t.Cleanup(s.StopAutoLock)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	s.LockVault()
	vaultID, err := s.vault.ID()
	if err != nil {
		t.Fatalf("ID: %v", err)
	}
	if err := creds.Delete(masterKeyIDFor(vaultID)); err != nil {
		t.Fatalf("Delete master key: %v", err)
	}
	if err := s.UnlockVault(); !errors.Is(err, ErrNoVaultKey) {
		t.Fatalf("UnlockVault with missing key = %v, want ErrNoVaultKey", err)
	}
}

func TestCreateUpdateDeleteSecret(t *testing.T) {
	s := newTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	created, err := s.CreateSecret("Bank", "alice", "pw-fake-1", "https://bank.example", "", "", "", "")
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	updated, err := s.UpdateSecret(created.ID, "Bank", "alice2", "pw-fake-2", "https://bank.example", "note", "", "", "")
	if err != nil {
		t.Fatalf("UpdateSecret: %v", err)
	}
	if updated.Username != "alice2" || updated.Password != "pw-fake-2" {
		t.Fatalf("updated = %+v", updated)
	}
	hist, err := s.SecretHistory(created.ID)
	if err != nil {
		t.Fatalf("SecretHistory: %v", err)
	}
	if len(hist) != 1 || hist[0].Username != "alice" {
		t.Fatalf("history = %+v", hist)
	}
	if err := s.DeleteSecret(created.ID); err != nil {
		t.Fatalf("DeleteSecret: %v", err)
	}
	if _, err := s.RevealSecret(created.ID); err == nil {
		t.Fatal("RevealSecret should fail after delete")
	}
}

func TestCreateSecret_RequiresTitle(t *testing.T) {
	s := newTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	if _, err := s.CreateSecret("", "u", "p", "", "", "", "", ""); err == nil {
		t.Fatal("CreateSecret with no title should fail")
	}
}

func TestResolveSecretValue(t *testing.T) {
	s := newTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	created, err := s.CreateSecret("API", "", "resolve-pw-fake", "", "", "", "", "")
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	got, err := s.ResolveSecretValue(created.ID, secretaudit.AccessContext{Context: secretaudit.ContextExecEnv})
	if err != nil {
		t.Fatalf("ResolveSecretValue: %v", err)
	}
	if got != "resolve-pw-fake" {
		t.Fatalf("ResolveSecretValue = %q, want resolve-pw-fake", got)
	}
}

func TestResolveSecretValue_Locked(t *testing.T) {
	s := newTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	created, err := s.CreateSecret("API", "", "resolve-pw-fake", "", "", "", "", "")
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	s.LockVault()
	if _, err := s.ResolveSecretValue(created.ID, secretaudit.AccessContext{Context: secretaudit.ContextExecEnv}); err == nil {
		t.Fatal("ResolveSecretValue on a locked vault returned nil error, want an error")
	}
}

func TestRedactKnownSecrets(t *testing.T) {
	s := newTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	if _, err := s.CreateSecret("API", "", "super-secret-fake", "", "", "", "", ""); err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}

	got := s.RedactKnownSecrets("auth failed for token super-secret-fake")
	if strings.Contains(got, "super-secret-fake") {
		t.Fatalf("RedactKnownSecrets = %q, still contains the secret", got)
	}
}

func TestRedactKnownSecrets_Locked_PassesThroughUnchanged(t *testing.T) {
	s := newTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	s.LockVault()

	text := "nothing redactable while locked"
	if got := s.RedactKnownSecrets(text); got != text {
		t.Fatalf("RedactKnownSecrets while locked = %q, want unchanged %q", got, text)
	}
}

func TestGeneratePassword(t *testing.T) {
	s := newTestService(t)
	got, err := s.GeneratePassword(16, true, true, true, false)
	if err != nil {
		t.Fatalf("GeneratePassword: %v", err)
	}
	if len(got) != 16 {
		t.Fatalf("length = %d, want 16", len(got))
	}
}

// TestAutoLock_FiresPastThreshold proves the idle-poll loop actually
// locks the vault once idleTimeFn reports past-threshold -- pinning the
// exact regression class a naive "start a ticker and forget it" wiring
// bug would produce (loop never actually calling Lock).
func TestAutoLock_FiresPastThreshold(t *testing.T) {
	path := t.TempDir() + "/secrets.kdbx"
	s := NewSecretService(secretvault.New(path), credential.NewInMemory(), servicetest.NewFakeStore())
	s.StopAutoLock() // replace the real-idletime loop below
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}

	origIdleTimeFn := idleTimeFn
	t.Cleanup(func() { idleTimeFn = origIdleTimeFn })
	idleTimeFn = func() (time.Duration, error) { return 20 * time.Second, nil }

	stop := s.startAutoLock(10*time.Second, 5*time.Millisecond)
	t.Cleanup(stop)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !s.VaultStatus().Unlocked {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("vault was not auto-locked within the deadline")
}

// TestAutoLock_ServerModeErrorNeverLocks pins the fail-toward-usable
// posture documented on startAutoLock: an idleTimeFn error (server
// mode's ErrUnsupportedInServerMode) must never lock the vault.
func TestAutoLock_ServerModeErrorNeverLocks(t *testing.T) {
	path := t.TempDir() + "/secrets.kdbx"
	s := NewSecretService(secretvault.New(path), credential.NewInMemory(), servicetest.NewFakeStore())
	s.StopAutoLock()
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}

	origIdleTimeFn := idleTimeFn
	t.Cleanup(func() { idleTimeFn = origIdleTimeFn })
	idleTimeFn = func() (time.Duration, error) { return 0, errors.New("no idle signal") }

	stop := s.startAutoLock(10*time.Millisecond, 5*time.Millisecond)
	t.Cleanup(stop)
	time.Sleep(50 * time.Millisecond)
	if !s.VaultStatus().Unlocked {
		t.Fatal("vault locked despite an idletime error -- should never lock without a real idle reading")
	}
}

func TestCopySecretToClipboard_ClearsAfterDelay(t *testing.T) {
	s := newTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	created, err := s.CreateSecret("Site", "u", "clip-pw-fake", "", "", "", "", "")
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}

	fake := &fakeClipboard{}
	origWrite, origRead := clipboardWriteFn, clipboardReadFn
	t.Cleanup(func() { clipboardWriteFn, clipboardReadFn = origWrite, origRead })
	clipboardWriteFn, clipboardReadFn = fake.write, fake.read

	origClear := clipboardAutoClear
	t.Cleanup(func() { clipboardAutoClear = origClear })
	clipboardAutoClear = 5 * time.Millisecond

	if err := s.CopySecretToClipboard(created.ID); err != nil {
		t.Fatalf("CopySecretToClipboard: %v", err)
	}
	if got := fake.get(); got != "clip-pw-fake" {
		t.Fatalf("clipboard = %q, want clip-pw-fake", got)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if fake.get() == "" {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("clipboard was not auto-cleared within the deadline")
}

func TestCopySecretToClipboard_DoesNotClobberNewerCopy(t *testing.T) {
	s := newTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	created, err := s.CreateSecret("Site", "u", "clip-pw-fake", "", "", "", "", "")
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}

	fake := &fakeClipboard{}
	origWrite, origRead := clipboardWriteFn, clipboardReadFn
	t.Cleanup(func() { clipboardWriteFn, clipboardReadFn = origWrite, origRead })
	clipboardWriteFn, clipboardReadFn = fake.write, fake.read

	origClear := clipboardAutoClear
	t.Cleanup(func() { clipboardAutoClear = origClear })
	clipboardAutoClear = 5 * time.Millisecond

	if err := s.CopySecretToClipboard(created.ID); err != nil {
		t.Fatalf("CopySecretToClipboard: %v", err)
	}
	// Simulate the user copying something else before the auto-clear fires.
	fake.set("something-else-the-user-copied")
	time.Sleep(50 * time.Millisecond)
	if got := fake.get(); got != "something-else-the-user-copied" {
		t.Fatalf("auto-clear clobbered a newer clipboard value: %q", got)
	}
}
