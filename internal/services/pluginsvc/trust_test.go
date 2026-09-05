package pluginsvc

import (
	"os"
	"path/filepath"
	"testing"
)

// The tier table, stated once: what checked the bytes decides the
// badge, and nothing else does.
func TestTierFor_TheWholeTable(t *testing.T) {
	cases := []struct {
		name string
		in   TierInputs
		want string
	}{
		{"a folder on this Mac is dev", TierInputs{FromFolder: true, DeclaredSHA256: "aa", ActualSHA256: "aa", Signed: true}, TierDev},
		{"a matching hash with a valid signature is verified", TierInputs{DeclaredSHA256: "aa", ActualSHA256: "AA", Signed: true}, TierVerified},
		{"a matching hash without a signature is hash-pinned", TierInputs{DeclaredSHA256: "aa", ActualSHA256: "aa"}, TierHashPinned},
		{"no declared hash is unverified", TierInputs{ActualSHA256: "aa", Signed: true}, TierUnverified},
		{"a mismatched hash is unverified", TierInputs{DeclaredSHA256: "aa", ActualSHA256: "bb", Signed: true}, TierUnverified},
	}
	for _, c := range cases {
		if got := TierFor(c.in); got != c.want {
			t.Errorf("%s: TierFor() = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestInstallRecord_RoundTrips(t *testing.T) {
	dir := t.TempDir()
	want := InstallRecord{
		Source:      PluginSource{Kind: "github", Repo: "acme/store", Ref: "v1"},
		Marketplace: "acme",
		Version:     "1.2.0",
		ContentHash: "sha256-abc",
		Tier:        TierHashPinned,
	}
	if err := WriteInstallRecord(dir, want); err != nil {
		t.Fatalf("WriteInstallRecord() = %v", err)
	}
	got, ok := ReadInstallRecord(dir)
	if !ok {
		t.Fatal("ReadInstallRecord() reported no record")
	}
	if got.Marketplace != want.Marketplace || got.Tier != want.Tier || got.Source.Repo != want.Source.Repo || got.Version != want.Version {
		t.Errorf("record = %+v, want %+v", got, want)
	}
	if got.InstalledAt == "" {
		t.Error("InstalledAt is empty, want a stamp written at install time")
	}
}

// The receipt is hidden, so the content hash's own walk never sees it
// -- writing it must not change what the folder hashes to.
func TestWriteInstallRecord_DoesNotChangeTheContentHash(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"id":"acme-notes"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	before, err := ContentHash(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := WriteInstallRecord(dir, InstallRecord{Tier: TierDev}); err != nil {
		t.Fatal(err)
	}
	after, err := ContentHash(filepath.Join(dir, ".")) // a distinct path, so the stat-fingerprint cache is not consulted
	if err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Errorf("hash changed after the receipt was written: %q -> %q", before, after)
	}
}

// A folder placed by hand has no receipt, and "dev" is the honest
// answer for it: nothing checked those bytes.
func TestInstalledTier_FallsBackToDevWithNoReceipt(t *testing.T) {
	if got := InstalledTier(t.TempDir(), false); got != TierDev {
		t.Errorf("InstalledTier(no receipt) = %q, want %q", got, TierDev)
	}
	if got := InstalledTier("", true); got != "" {
		t.Errorf("InstalledTier(builtin) = %q, want an empty tier", got)
	}
}
