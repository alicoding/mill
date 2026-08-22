//go:build darwin && !server

package codesigning

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"fmt"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func timeoutContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), codesignTimeout)
}

// identityCommonName is the certificate's subject CN and the name
// passed to `codesign -s`. Distinctive on purpose: EnsureIdentity
// looks it up by this exact name, so it must never collide with a
// real Developer ID or another local certificate.
const identityCommonName = "Mill Local Signing"

// keychainFileName is Mill's own dedicated keychain, kept separate
// from the login keychain: granting `codesign` non-interactive access
// to a key (`security set-key-partition-list`) requires the target
// keychain's own unlock password, and the login keychain's real
// password is the user's account password, which Mill cannot supply
// programmatically. A keychain Mill creates itself can use a known
// (empty) password for that one non-interactive step while staying
// exactly as private as any other per-user keychain file (standard
// macOS 0600 file permissions, readable only by this account) --
// the same non-interactive-signing pattern documented for headless
// macOS CI runners.
const keychainFileName = "Mill-Signing.keychain-db"

// codesignTimeout bounds every codesign/security invocation below,
// mirroring launchatlogin's osascriptTimeout: a hung external process
// must never hang Mill's own update flow.
const codesignTimeout = 30 * time.Second

func defaultKeychainPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(home, "Library", "Keychains", keychainFileName), nil
}

// EnsureIdentity returns Mill's per-machine signing identity, creating
// it on first call. Idempotent: a second call against an
// already-provisioned keychain finds the existing certificate and
// returns the same SHA1 without generating a new key pair -- the
// stable identity IS the mechanism (a fresh key pair each call would
// reproduce the ad-hoc problem this package exists to fix).
func EnsureIdentity() (Identity, error) {
	path, err := defaultKeychainPath()
	if err != nil {
		return Identity{}, err
	}
	return ensureIdentityAt(path)
}

func ensureIdentityAt(path string) (Identity, error) {
	if err := ensureKeychain(path); err != nil {
		return Identity{}, err
	}
	if id, ok, err := findExistingIdentity(path); err != nil {
		return Identity{}, err
	} else if ok {
		if err := ensureInSearchList(path); err != nil {
			return Identity{}, err
		}
		return id, nil
	}
	if err := createIdentity(path); err != nil {
		return Identity{}, err
	}
	if err := ensureInSearchList(path); err != nil {
		return Identity{}, err
	}
	id, ok, err := findExistingIdentity(path)
	if err != nil {
		return Identity{}, err
	}
	if !ok {
		return Identity{}, fmt.Errorf("codesigning: identity not found immediately after creation")
	}
	return id, nil
}

// ensureKeychain creates path with an empty password if absent
// (idempotent: `security create-keychain` on an existing file errors,
// so existence is checked first), disables its auto-lock timeout, and
// unlocks it -- three steps every CI-standard non-interactive macOS
// signing setup performs on a dedicated keychain.
func ensureKeychain(path string) error {
	if _, err := os.Stat(path); err == nil {
		return unlockKeychain(path)
	}
	if err := runSecurity("create-keychain", "-p", "", path); err != nil {
		return fmt.Errorf("create signing keychain: %w", err)
	}
	if err := runSecurity("set-keychain-settings", path); err != nil {
		return fmt.Errorf("disable signing keychain auto-lock: %w", err)
	}
	return unlockKeychain(path)
}

func unlockKeychain(path string) error {
	if err := runSecurity("unlock-keychain", "-p", "", path); err != nil {
		return fmt.Errorf("unlock signing keychain: %w", err)
	}
	return nil
}

// findExistingIdentity looks up identityCommonName's certificate in
// path and reports whether it exists. security find-certificate exits
// non-zero when nothing matches -- that is the normal "not yet
// created" case, not an error to surface.
func findExistingIdentity(path string) (Identity, bool, error) {
	ctx, cancel := timeoutContext()
	defer cancel()
	// #nosec G204 -- args are the fixed "security find-certificate"
	// verb plus identityCommonName (a package constant) and path (this
	// package's own keychain file), never external input.
	out, err := exec.CommandContext(ctx, "security", "find-certificate", "-c", identityCommonName, "-Z", path).CombinedOutput()
	if err != nil {
		return Identity{}, false, nil
	}
	sha1, ok := parseSHA1(string(out))
	if !ok {
		return Identity{}, false, fmt.Errorf("codesigning: could not parse SHA-1 hash from find-certificate output")
	}
	return Identity{Name: identityCommonName, SHA1: sha1}, true, nil
}

func parseSHA1(output string) (string, bool) {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if rest, ok := strings.CutPrefix(line, "SHA-1 hash:"); ok {
			return strings.TrimSpace(rest), true
		}
	}
	return "", false
}

// createIdentity generates a fresh RSA key pair and a self-signed,
// code-signing-EKU certificate (Apple TN2206: self-signed identities
// are valid DR anchors without a trust chain), then imports both as
// separate DER files -- `security import` links a cert and a private
// key sharing the same public key into one queryable identity without
// needing a PKCS12 container, which sidesteps relying on whatever
// `openssl` happens to be first on PATH (this repo's own machine has
// three different openssl builds across /usr/bin, Homebrew, and
// conda).
func createIdentity(path string) error {
	certDER, keyDER, err := generateSelfSignedCert()
	if err != nil {
		return fmt.Errorf("generate signing certificate: %w", err)
	}
	dir, err := os.MkdirTemp("", "mill-codesigning-*")
	if err != nil {
		return fmt.Errorf("create temp dir for signing material: %w", err)
	}
	defer func() { _ = os.RemoveAll(dir) }()

	certFile := filepath.Join(dir, "cert.der")
	keyFile := filepath.Join(dir, "key.der")
	if err := os.WriteFile(certFile, certDER, 0o600); err != nil {
		return fmt.Errorf("write cert file: %w", err)
	}
	if err := os.WriteFile(keyFile, keyDER, 0o600); err != nil {
		return fmt.Errorf("write key file: %w", err)
	}

	if err := runSecurity("import", certFile, "-k", path, "-t", "cert", "-T", "/usr/bin/codesign", "-T", "/usr/bin/security"); err != nil {
		return fmt.Errorf("import signing certificate: %w", err)
	}
	if err := runSecurity("import", keyFile, "-k", path, "-t", "priv", "-T", "/usr/bin/codesign", "-T", "/usr/bin/security"); err != nil {
		return fmt.Errorf("import signing private key: %w", err)
	}
	// The keychain's own password is the known empty string (set at
	// creation), so this ACL grant needs no interactive prompt --
	// unlike the same operation against the login keychain, whose
	// real password Mill cannot supply.
	if err := runSecurity("set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", "", path); err != nil {
		return fmt.Errorf("grant codesign access to the signing key: %w", err)
	}
	return nil
}

// generateSelfSignedCert returns a DER-encoded certificate (with a
// Code Signing extended key usage) and its matching DER-encoded PKCS8
// private key.
func generateSelfSignedCert() (certDER, keyDER []byte, err error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, nil, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, nil, err
	}
	tmpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: identityCommonName},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(30, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageCodeSigning},
		BasicConstraintsValid: true,
		IsCA:                  false,
	}
	certDER, err = x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, nil, err
	}
	keyDER, err = x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, nil, err
	}
	return certDER, keyDER, nil
}

// ensureInSearchList appends path to the user's keychain search list
// if it isn't already present -- `codesign -s <name>` resolves an
// identity by searching every keychain on this list, not just the one
// named by --keychain. Never removes an existing entry.
func ensureInSearchList(path string) error {
	ctx, cancel := timeoutContext()
	defer cancel()
	// #nosec G204 -- fixed argv, no variable input at all.
	out, err := exec.CommandContext(ctx, "security", "list-keychains", "-d", "user").CombinedOutput()
	if err != nil {
		return fmt.Errorf("list keychain search path: %w", err)
	}
	var current []string
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		line = strings.Trim(line, `"`)
		if line == "" {
			continue
		}
		current = append(current, line)
		if line == path {
			return nil
		}
	}
	args := append([]string{"list-keychains", "-d", "user", "-s"}, current...)
	args = append(args, path)
	if err := runSecurity(args...); err != nil {
		return fmt.Errorf("add signing keychain to search list: %w", err)
	}
	return nil
}

// runSecurity invokes /usr/bin/security with args, always bounded by
// codesignTimeout -- every call site here operates on this package's
// own keychain file and constants, never external input.
func runSecurity(args ...string) error {
	ctx, cancel := timeoutContext()
	defer cancel()
	// #nosec G204 -- see the function comment above.
	cmd := exec.CommandContext(ctx, "security", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

// SignBundle re-signs the .app bundle at path with Mill's own signing
// identity, creating that identity first if it doesn't exist yet.
// Fails fast (never hangs) when the identity exists but hasn't been
// granted "Always Trust" yet -- codesign refuses an untrusted
// self-signed identity outright rather than prompting, since trusting
// a certificate is a one-time action only the user can grant
// (Keychain Access, or the system authorization dialog) and Mill's own
// process is never Apple-entitled to grant it silently.
func SignBundle(path string) error {
	id, err := EnsureIdentity()
	if err != nil {
		return err
	}
	keychainPath, err := defaultKeychainPath()
	if err != nil {
		return err
	}
	return signBundleWith(path, keychainPath, id.Name)
}

// signBundleWith is SignBundle's keychain/identity-parameterized core,
// split out so tests can point it at a disposable keychain instead of
// the real per-machine one.
func signBundleWith(bundlePath, keychainPath, identityName string) error {
	ctx, cancel := timeoutContext()
	defer cancel()
	// #nosec G204 -- identityName/keychainPath come from EnsureIdentity
	// (this package's own generated identity), bundlePath from the
	// caller's own resolved app-bundle/staged-update path, never
	// external input.
	cmd := exec.CommandContext(ctx, "codesign",
		"--force", "--deep", "--timestamp=none",
		"--sign", identityName,
		"--keychain", keychainPath,
		bundlePath,
	)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("codesign %s: %w: %s", bundlePath, err, strings.TrimSpace(stderr.String()))
	}
	return nil
}
