#!/usr/bin/env bash
# Enforces goal 0356: tests and e2e servers never touch a real host
# resource (the pasteboard, the OS keychain, the system browser) by
# accident. internal/adapters/clipboard.NewHost,
# internal/adapters/credential.New, and internal/adapters/osopen.NewHost
# all panic if constructed inside a `go test` binary unless the caller
# opts in (MILL_CLIPBOARD_HOST_OK / MILL_ALLOW_HOST_KEYCHAIN_IN_TESTS /
# MILL_OPEN_HOST_OK) -- this script catches the ways those opt-ins could
# be misused: a _test.go file referencing the real constructor without
# ever setting its opt-in anywhere in the same file (the panic would
# fire at test time, but a reviewer should see the mismatch before
# that), an e2e spec that spawns a server with MILL_CLIPBOARD=host
# without wrapping it in withClipboardLock (the cross-process lock
# every real-pasteboard e2e test needs -- frontend/e2e/fixtures/
# clipboardLock.ts), and a frontend source file calling Browser.OpenURL
# directly instead of through shared/openExternal.ts's own one door
# (goal 0356 part 2). Run by lefthook (pre-commit) and CI's
# test-side-effects job -- one script both call, same non-drift shape
# as check-comment-hygiene.sh.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

violations=0

# -- Go: a _test.go file constructing the real Host clipboard adapter
# (clipboard.NewHost, or a bare NewHost() inside the clipboard package's
# own tests) must opt in via MILL_CLIPBOARD_HOST_OK in the SAME file,
# not just rely on it being set somewhere else in the process. Scoped by
# file path the same way the keychain block below is, so this never
# collides with osopen's OWN same-named NewHost (its own block further
# down, gated on MILL_OPEN_HOST_OK instead).
while IFS= read -r -d '' file; do
  case "$file" in
    *_test.go) ;;
    *) continue ;;
  esac
  case "$file" in
    internal/adapters/clipboard/*_test.go) pattern='\bNewHost\(' ;;
    *) pattern='clipboard\.NewHost\(' ;;
  esac
  if ! grep -qE "$pattern" "$file"; then
    continue
  fi
  if ! grep -q 'MILL_CLIPBOARD_HOST_OK' "$file"; then
    echo "test-side-effects: $file: calls NewHost() without setting MILL_CLIPBOARD_HOST_OK in the same file -- this would panic at test time; see internal/adapters/clipboard's own NewHost doc comment for the deliberate real-pasteboard-test seam"
    violations=$((violations + 1))
  fi
done < <(git ls-files -z -- '*_test.go')

# -- Go: a _test.go file constructing the real OS-opener adapter
# (osopen.NewHost, or a bare NewHost() inside the osopen package's own
# tests) must opt in via MILL_OPEN_HOST_OK in the SAME file -- goal 0356
# part 2's own guard, the third instance of this defect class.
while IFS= read -r -d '' file; do
  case "$file" in
    *_test.go) ;;
    *) continue ;;
  esac
  case "$file" in
    internal/adapters/osopen/*_test.go) pattern='\bNewHost\(' ;;
    *) pattern='osopen\.NewHost\(' ;;
  esac
  if ! grep -qE "$pattern" "$file"; then
    continue
  fi
  if ! grep -q 'MILL_OPEN_HOST_OK' "$file"; then
    echo "test-side-effects: $file: calls NewHost() without setting MILL_OPEN_HOST_OK in the same file -- this would panic at test time; see internal/adapters/osopen's own NewHost doc comment for the deliberate real-open-test seam"
    violations=$((violations + 1))
  fi
done < <(git ls-files -z -- '*_test.go')

# -- Go: a _test.go file constructing the real OS keychain adapter
# (credential.New, or a bare New() inside the credential package's own
# tests) must opt in via MILL_ALLOW_HOST_KEYCHAIN_IN_TESTS in the SAME
# file. Every other test must call credential.NewInMemory() instead.
while IFS= read -r -d '' file; do
  case "$file" in
    *_test.go) ;;
    *) continue ;;
  esac
  case "$file" in
    internal/adapters/credential/*_test.go) pattern='\bNew\(\)' ;;
    *) pattern='credential\.New\(\)' ;;
  esac
  if ! grep -qE "$pattern" "$file"; then
    continue
  fi
  if ! grep -q 'MILL_ALLOW_HOST_KEYCHAIN_IN_TESTS' "$file"; then
    echo "test-side-effects: $file: constructs the real OS keychain adapter without setting MILL_ALLOW_HOST_KEYCHAIN_IN_TESTS in the same file -- this would panic at test time; use credential.NewInMemory() instead, or see internal/adapters/credential's own New doc comment for the deliberate real-keychain-test seam"
    violations=$((violations + 1))
  fi
done < <(git ls-files -z -- '*_test.go')

# -- e2e: a spec spawning a server with MILL_CLIPBOARD=host must also
# wrap the real-pasteboard flow in withClipboardLock, the cross-process
# lock serializing every test that touches the one real OS pasteboard
# (frontend/e2e/fixtures/clipboardLock.ts).
while IFS= read -r -d '' file; do
  case "$file" in
    frontend/e2e/*.spec.ts) ;;
    *) continue ;;
  esac
  if ! grep -qE "MILL_CLIPBOARD['\"]?[[:space:]]*:[[:space:]]*['\"]host['\"]" "$file"; then
    continue
  fi
  if ! grep -q 'withClipboardLock' "$file"; then
    echo "test-side-effects: $file: spawns a server with MILL_CLIPBOARD=host without withClipboardLock -- wrap the real-pasteboard flow (frontend/e2e/fixtures/clipboardLock.ts)"
    violations=$((violations + 1))
  fi
done < <(git ls-files -z -- 'frontend/e2e/*.spec.ts')

# -- frontend: Browser.OpenURL reaches the real OS browser opener
# directly, over a wire osopen's Port never sees -- shared/openExternal.ts
# is the ONE file allowed to call it (mirrored by an ESLint restriction,
# frontend/eslint.config.js).
while IFS= read -r -d '' file; do
  case "$file" in
    frontend/src/shared/openExternal.ts) continue ;;
  esac
  if grep -q 'Browser\.OpenURL' "$file"; then
    echo "test-side-effects: $file: calls Browser.OpenURL directly -- route external links through frontend/src/shared/openExternal.ts's openExternalUrl (goal 0356 part 2)"
    violations=$((violations + 1))
  fi
done < <(git ls-files -z -- 'frontend/src/**/*.ts' 'frontend/src/**/*.tsx')

if ((violations > 0)); then
  echo "error: $violations test-side-effect violation(s) -- see .claude/rules/testing.md's clipboard sentence and goal 0356." >&2
  exit 1
fi

echo "test-side-effects: no violations"
