#!/usr/bin/env bash
# Imports Mill's stable beta-signing identity into a fresh, disposable
# keychain so `codesign --sign "Mill Beta Signing"` (build/darwin/
# Taskfile.yml's codesign:identity task, via `task package
# SIGN_IDENTITY="Mill Beta Signing"`) can find it without a
# `--keychain` flag or any interactive prompt -- the same script CI's
# beta-release job (.github/workflows/ci.yml) and a local verification
# run both call, so the two can never drift.
#
# Reads the p12 from MILL_BETA_SIGNING_P12 (base64) and
# MILL_BETA_SIGNING_P12_PASSWORD (its export password) -- never as
# arguments, which would land in shell history/process listings.
# Neither value is echoed anywhere below.
#
# Prints the created keychain's path on stdout as the LAST line (the
# only stdout contract this script makes) so the caller can capture it
# for cleanup: `security delete-keychain "$path"` once signing is
# done. This script does not delete it itself -- CI needs that
# cleanup in its own always() step so it still runs when a later step
# fails, and a script-level `trap` would not survive past this
# process exiting.
set -euo pipefail

: "${MILL_BETA_SIGNING_P12:?MILL_BETA_SIGNING_P12 (base64 p12) is required}"
: "${MILL_BETA_SIGNING_P12_PASSWORD:?MILL_BETA_SIGNING_P12_PASSWORD is required}"

# Two SEPARATE temp dirs, deliberately: p12_dir holds the decoded
# private-key material and is wiped the moment this script exits, but
# keychain_dir holds the keychain the caller still needs AFTER this
# script exits (to sign, then to delete) -- putting both under one
# trap-cleaned dir would delete the keychain out from under the caller
# before it ever got used (confirmed directly: the first version of
# this script did exactly that).
p12_dir="$(mktemp -d)"
trap 'rm -rf "$p12_dir"' EXIT
keychain_dir="$(mktemp -d)"

keychain_path="$keychain_dir/mill-beta-signing.keychain-db"
p12_path="$p12_dir/mill-beta-signing.p12"
# Random and used only for this keychain's own create/unlock/partition-
# list calls below -- never a secret Mill stores or reuses, so it
# needs no dedicated GH secret of its own.
keychain_password="$(openssl rand -base64 24)"

printf '%s' "$MILL_BETA_SIGNING_P12" | base64 --decode > "$p12_path"

## Every call below is silenced on stdout (stderr still flows, so a
## real failure's message still reaches the log): `security import` in
## particular dumps the whole imported-item attribute record, which
## would otherwise land ahead of this script's one-line stdout
## contract and corrupt a caller doing `path="$(this script)"`.
security create-keychain -p "$keychain_password" "$keychain_path" >/dev/null
security set-keychain-settings "$keychain_path" >/dev/null
security unlock-keychain -p "$keychain_password" "$keychain_path" >/dev/null
security import "$p12_path" -k "$keychain_path" -P "$MILL_BETA_SIGNING_P12_PASSWORD" \
  -T /usr/bin/codesign -T /usr/bin/security >/dev/null
# codesign resolves a bare identity name (no --keychain flag, the
# shape build/darwin/Taskfile.yml's codesign:identity task uses)
# against the user's keychain SEARCH LIST, not just the login
# keychain -- confirmed directly: importing alone leaves the identity
# invisible to a flag-less `codesign --sign`, adding the keychain to
# this list is what makes it resolve.
security list-keychains -d user -s "$keychain_path" login.keychain-db >/dev/null
# Grants codesign/security non-interactive access to the imported
# private key -- without it, the FIRST codesign call against this
# identity blocks on a keychain-access prompt no CI runner can answer.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain_path" >/dev/null

echo "$keychain_path"
