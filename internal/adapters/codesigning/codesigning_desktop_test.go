//go:build darwin && !server

package codesigning

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// captureSearchList and restoreSearchList keep these tests from
// permanently altering the machine's own keychain search list:
// ensureIdentityAt appends its (temp-dir) keychain path so codesign
// can find the identity, and the temp dir is gone once the test ends.
func captureSearchList(t *testing.T) []string {
	t.Helper()
	ctx, cancel := timeoutContext()
	defer cancel()
	// #nosec G204 -- fixed argv, no variable input.
	out, err := exec.CommandContext(ctx, "security", "list-keychains", "-d", "user").CombinedOutput()
	if err != nil {
		t.Fatalf("list-keychains: %v: %s", err, out)
	}
	var list []string
	for _, line := range strings.Split(string(out), "\n") {
		line := strings.Trim(strings.TrimSpace(line), `"`)
		if line != "" {
			list = append(list, line)
		}
	}
	return list
}

func restoreSearchList(t *testing.T, original []string) {
	t.Helper()
	ctx, cancel := timeoutContext()
	defer cancel()
	args := append([]string{"list-keychains", "-d", "user", "-s"}, original...)
	// #nosec G204 -- args are this test's own captured/restored keychain
	// list, never external input.
	if out, err := exec.CommandContext(ctx, "security", args...).CombinedOutput(); err != nil {
		t.Errorf("restore search list: %v: %s", err, out)
	}
}

func TestEnsureIdentityAt_CreatesThenIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test-mill-signing.keychain-db")

	original := captureSearchList(t)
	t.Cleanup(func() { restoreSearchList(t, original) })

	first, err := ensureIdentityAt(path)
	if err != nil {
		t.Fatalf("ensureIdentityAt (create): %v", err)
	}
	if first.Name != identityCommonName {
		t.Errorf("Name = %q, want %q", first.Name, identityCommonName)
	}
	if first.SHA1 == "" {
		t.Error("SHA1 is empty after creation")
	}

	second, err := ensureIdentityAt(path)
	if err != nil {
		t.Fatalf("ensureIdentityAt (repeat call): %v", err)
	}
	if second.SHA1 != first.SHA1 {
		t.Errorf("SHA1 changed across calls (%q -> %q); a second call must reuse the existing identity, not mint a new one", first.SHA1, second.SHA1)
	}
}

// TestSignBundleWith_MissingBundle_ReturnsWrappedError pins
// signBundleWith's error-wrapping behavior (codesign's stderr must
// land in the returned error, not be swallowed) using a failure mode
// that is deterministic regardless of the identity's trust status: a
// bundle path that does not exist. Deliberately does NOT assert
// whether signing a real bundle with a freshly created, not-yet-
// "Always Trusted" self-signed identity succeeds or fails -- that
// depends on this machine's own trust-evaluation state (observed to
// vary independent of this package's own logic), which is exactly
// why the real re-sign path treats a signing failure as non-fatal
// (see SignBundle's caller in settingssvc) rather than assuming
// either outcome.
func TestSignBundleWith_MissingBundle_ReturnsWrappedError(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test-mill-signing.keychain-db")

	original := captureSearchList(t)
	t.Cleanup(func() { restoreSearchList(t, original) })

	id, err := ensureIdentityAt(path)
	if err != nil {
		t.Fatalf("ensureIdentityAt: %v", err)
	}

	missing := filepath.Join(dir, "does-not-exist.app")
	err = signBundleWith(missing, path, id.Name)
	if err == nil {
		t.Fatal("signBundleWith succeeded against a nonexistent bundle path, want an error")
	}
	if !strings.Contains(err.Error(), "codesign") {
		t.Errorf("error = %v, want it to name codesign for a copyable diagnostic", err)
	}
}
