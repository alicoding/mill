#!/usr/bin/env bash
# One-time local setup for a STABLE macOS code-signing identity (goal
# 0381): `codesign --sign -` (ad-hoc, build/darwin/Taskfile.yml's
# codesign:adhoc) has no Team Identifier, so TCC keys an Accessibility
# grant to the binary's own code digest -- different on every rebuild,
# dropping the grant every `task install:app`. A stable self-signed
# identity keeps the SAME signing identity across rebuilds, so ONE
# Accessibility grant (System Settings > Privacy & Security >
# Accessibility) persists.
#
# Idempotent: re-running with the identity already present and trusted
# just reprints its SHA-1 and exits 0; re-running after a partial run
# (certificate imported but not yet trusted) reuses that certificate
# instead of generating a second one under the same name. Never stores
# a password -- the private key stays in the login keychain, protected
# by the OS login keychain unlock, the same as any other locally-
# generated signing key.
set -euo pipefail

identity_name="Mill Dev Signing"
login_keychain="$HOME/Library/Keychains/login.keychain-db"
# A stable (not mktemp-cleaned) cache dir: the printed fallback command
# below names a certificate file path, which must still exist when the
# owner actually runs it -- possibly well after this script exits.
cache_dir="$HOME/Library/Application Support/mill/dev-signing"
cert_path="$cache_dir/mill-dev-signing.pem"

# Idempotency against a defect an earlier version of this script had:
# a `-out out.p12` temp filename with no PKCS#12 friendly name leaked
# into the imported private key's OWN Keychain label ("out", not "Mill
# Dev Signing") -- confirmed live. A stray key under that label is
# useless (nothing looks it up by "out") and would sit beside the
# correctly-labeled one forever; delete it before doing anything else
# so re-running this script on an already-bitten machine self-heals.
security delete-key -l out "$login_keychain" >/dev/null 2>&1 || true

sha1_of_trusted() {
  security find-identity -v -p codesigning "$login_keychain" 2>/dev/null \
    | grep "\"$identity_name\"" \
    | sed -E 's/^[[:space:]]*[0-9]+\) ([0-9A-F]+) .*/\1/' \
    | head -1
}

existing_sha1="$(sha1_of_trusted || true)"
if [ -n "$existing_sha1" ]; then
  echo "Signing identity \"$identity_name\" already present and trusted: $existing_sha1"
  exit 0
fi

mkdir -p "$cache_dir"

if security find-certificate -c "$identity_name" -Z "$login_keychain" >/dev/null 2>&1; then
  echo "Certificate \"$identity_name\" already imported but not yet trusted for code signing -- reusing it."
  security find-certificate -c "$identity_name" -p "$login_keychain" > "$cert_path"
else
  echo "Generating a local self-signed code-signing certificate: \"$identity_name\"..."
  work_dir="$(mktemp -d)"
  trap 'rm -rf "$work_dir"' EXIT
  key_path="$work_dir/mill-dev-signing.key"
  p12_path="$work_dir/mill-dev-signing.p12"

  # keyUsage=critical,digitalSignature + extendedKeyUsage=critical,
  # codeSigning is what makes codesign accept this certificate as a
  # valid signing identity at all -- confirmed directly: a non-critical
  # extendedKeyUsage still passes `security import` and `find-identity`
  # cleanly but codesign itself then refuses it ("no identity found")
  # once trusted, with no clearer diagnostic. 10 years: a local dev
  # convenience, not a distribution artifact subject to CA lifetime
  # policy.
  openssl req -x509 -newkey rsa:2048 -keyout "$key_path" -out "$cert_path" \
    -days 3650 -nodes -subj "/CN=$identity_name" \
    -addext "keyUsage=critical,digitalSignature" \
    -addext "extendedKeyUsage=critical,codeSigning" \
    -addext "basicConstraints=critical,CA:false" >/dev/null 2>&1

  # security import needs a PKCS#12 bundle, not separate PEM cert+key.
  # -legacy: OpenSSL 3's default PKCS12 MAC/cipher isn't one
  # `security import` can read (fails "MAC verification failed", empty
  # OR non-empty passphrase alike -- confirmed directly, not assumed);
  # -legacy produces the RC2/3DES-based format macOS's importer expects.
  # An empty passphrase hits the same MAC-verification failure on
  # import (confirmed directly) -- a random one-shot passphrase avoids
  # it. Generated fresh, used only in-memory for these two commands,
  # and never written anywhere else: NOT the same thing as storing a
  # password (nothing persists it after this process exits).
  # -name: without an explicit PKCS#12 friendly name, `security import`
  # falls back to labelling the imported private key from the p12
  # FILENAME instead of the certificate's own CN -- confirmed live (a
  # temp file named out.p12 produced a key literally labelled "out" in
  # Keychain Access, indistinguishable from any other stray key at a
  # glance). Naming it explicitly keeps the key's own label the same as
  # the identity everywhere else.
  p12_pass="$(openssl rand -base64 24)"
  openssl pkcs12 -export -legacy -name "$identity_name" -out "$p12_path" \
    -inkey "$key_path" -in "$cert_path" -passout "pass:$p12_pass" >/dev/null 2>&1

  # -T /usr/bin/codesign -T /usr/bin/security: both tools may use this
  # identity's private key without a per-signing keychain-access
  # prompt. This alone does not guarantee zero prompts -- the FIRST
  # time codesign actually reads the key, macOS may still show a
  # one-time "codesign wants to access key ... enter the login
  # keychain password" dialog (confirmed live); there is no way to
  # pre-answer that non-interactively without storing the login
  # keychain password, which this script never does. Choose "Always
  # Allow" there once and it never asks again for this key.
  security import "$p12_path" -k "$login_keychain" \
    -T /usr/bin/codesign -T /usr/bin/security -P "$p12_pass" >/dev/null
fi

raw_sha1="$(security find-certificate -c "$identity_name" -Z "$login_keychain" 2>/dev/null | sed -n 's/^SHA-1 hash: //p' | head -1)"

echo "Trusting it for code signing..."

# add-trusted-cert changes trust settings, which macOS gates behind an
# interactive authorization prompt (a GUI dialog, or an admin password
# for the system-wide -d store) -- there is no way to answer that
# non-interactively without storing a password, so a hang here (no TTY
# response) must not block the script forever.
if timeout 10 security add-trusted-cert -r trustRoot -p codeSign -k "$login_keychain" "$cert_path" 2>/dev/null; then
  final_sha1="$(sha1_of_trusted || true)"
  echo "Trusted for code signing. Identity SHA-1: ${final_sha1:-$raw_sha1}"
  echo "The first codesign against this identity may show a one-time \"codesign wants to access key ... enter the login keychain password\" dialog -- choose Always Allow; it will not ask again."
  exit 0
fi

cat >&2 <<EOF
The certificate is imported (SHA-1: $raw_sha1) but trusting it for code
signing needs a one-time interactive confirmation this script cannot
give non-interactively. Run this once yourself, then re-run this
script to confirm:

  security add-trusted-cert -r trustRoot -p codeSign -k "$login_keychain" "$cert_path"
EOF
exit 2
