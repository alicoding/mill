package pluginsvc

import (
	"os"
	"path/filepath"
	"strings"

	"aead.dev/minisign"
)

// The opt-in signed tier (ADR-0051 §4, slice 5): an administrator pins
// one or more minisign public keys in the settings file; from then on
// a non-built-in plugin runs only when its folder carries
// mill-plugin.minisig, a minisign signature over the folder's content
// hash string, that verifies against one of those keys. Offline by
// construction -- a key, a message, a signature; no trust root to
// refresh, no log to consult. The signature file itself is excluded
// from the hash it signs.

// SignatureFile is the detached signature's name inside a plugin
// folder.
const SignatureFile = "mill-plugin.minisig"

// SetSigningKeys installs the policy source (the settings service,
// wired by the composition root). Empty means no signing policy.
//
//wails:ignore
func (p *PluginService) SetSigningKeys(fn func() []string) {
	p.signingKeys = fn
}

func (p *PluginService) signingKeySet() []minisign.PublicKey {
	if p.signingKeys == nil {
		return nil
	}
	var keys []minisign.PublicKey
	for _, raw := range p.signingKeys() {
		var pk minisign.PublicKey
		if err := pk.UnmarshalText([]byte(strings.TrimSpace(raw))); err != nil {
			continue // an unparseable key pins nothing; the audit lists the policy as configured
		}
		keys = append(keys, pk)
	}
	return keys
}

// SignatureVerified reports whether the folder's signature verifies
// against any pinned key. False when no key is pinned, no signature
// ships, or the hash is unknown.
func SignatureVerified(dir, contentHash string, keys []minisign.PublicKey) bool {
	if len(keys) == 0 || contentHash == "" {
		return false
	}
	sig, err := os.ReadFile(filepath.Join(dir, SignatureFile)) // #nosec G304 G703 -- the plugin's own folder, resolved by the scan
	if err != nil {
		return false
	}
	for _, pk := range keys {
		if minisign.Verify(pk, []byte(contentHash), sig) {
			return true
		}
	}
	return false
}

// SigningPolicyActive reports whether any key is pinned.
func (p *PluginService) SigningPolicyActive() bool {
	return len(p.signingKeySet()) > 0
}

// SignedOK is the run policy's question: with no policy every plugin
// passes; with one, only a verified signature does.
func (p *PluginService) SignedOK(id string) bool {
	keys := p.signingKeySet()
	if len(keys) == 0 {
		return true
	}
	info := p.resolvePlugin(id)
	return info.Builtin || SignatureVerified(info.Dir, info.ContentHash, keys)
}
