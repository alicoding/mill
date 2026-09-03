package pluginsvc

import (
	"crypto/rand"
	"os"
	"path/filepath"
	"testing"

	"aead.dev/minisign"
)

// With a pinned key, only a plugin whose folder hash is signed by that
// key passes; the signature file never changes the hash it signs; a
// re-signed edit passes again.
func TestSigning_PinnedKeyGatesUnsignedAndTamperedPlugins(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "signed", `{"id":"signed","name":"S","version":"1"}`, nil)
	writePlugin(t, root, "unsigned", `{"id":"unsigned","name":"U","version":"1"}`, nil)
	pub, priv, err := minisign.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pubText, _ := pub.MarshalText()
	p := New(root, nil, "")
	if !p.SignedOK("unsigned") {
		t.Fatal("no policy: every plugin must pass")
	}
	p.SetSigningKeys(func() []string { return []string{string(pubText), "not a key"} })
	if !p.SigningPolicyActive() {
		t.Fatal("policy not active with a pinned key")
	}
	if p.SignedOK("unsigned") || p.SignedOK("signed") {
		t.Fatal("an unsigned plugin passed under a signing policy")
	}
	if !p.SignedOK("mill-drawing") {
		t.Fatal("the built-in was gated by the signing policy")
	}
	dir := filepath.Join(root, "signed")
	hash, _ := ContentHash(dir)
	if err := os.WriteFile(filepath.Join(dir, SignatureFile), minisign.Sign(priv, []byte(hash)), 0o600); err != nil {
		t.Fatal(err)
	}
	if again, _ := ContentHash(dir); again != hash {
		t.Fatal("the signature file changed the hash it signs")
	}
	if !p.SignedOK("signed") {
		t.Fatal("a correctly signed plugin was refused")
	}
	if err := os.WriteFile(filepath.Join(dir, "main.js"), []byte("export function activate() { /* tampered */ }"), 0o600); err != nil {
		t.Fatal(err)
	}
	if p.SignedOK("signed") {
		t.Fatal("a tampered plugin still verified")
	}
	info := p.resolvePlugin("signed")
	if !info.SigningPolicy || info.Signed {
		t.Fatalf("scan = policy %v signed %v, want policy on and unsigned after tampering", info.SigningPolicy, info.Signed)
	}
}
