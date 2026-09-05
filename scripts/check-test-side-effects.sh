#!/usr/bin/env bash
# Enforces goal 0356: tests and e2e servers never touch a real host
# resource (the pasteboard, the OS keychain) by accident.
# internal/adapters/clipboard.NewHost and internal/adapters/credential.
# New both panic if constructed inside a `go test` binary unless the
# caller opts in (MILL_CLIPBOARD_HOST_OK / MILL_ALLOW_HOST_KEYCHAIN_IN_
# TESTS) -- this script catches the ways those opt-ins could be misused:
# a _test.go file referencing the real constructor without ever setting
# its opt-in anywhere in the same file (the panic would fire at test
# time, but a reviewer should see the mismatch before that), and an e2e
# spec that spawns a server with MILL_CLIPBOARD=host without wrapping it
# in withClipboardLock (the cross-process lock every real-pasteboard e2e
# test needs -- frontend/e2e/fixtures/clipboardLock.ts). Run by lefthook
# (pre-commit) and CI's test-side-effects job -- one script both call,
# same non-drift shape as check-comment-hygiene.sh.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

violations=0

# -- Go: a _test.go file constructing the real Host clipboard adapter
# must opt in via MILL_CLIPBOARD_HOST_OK in the SAME file, not just rely
# on it being set somewhere else in the process.
while IFS= read -r -d '' file; do
  case "$file" in
    *_test.go) ;;
    *) continue ;;
  esac
  if ! grep -qE '\bNewHost\(' "$file"; then
    continue
  fi
  if ! grep -q 'MILL_CLIPBOARD_HOST_OK' "$file"; then
    echo "test-side-effects: $file: calls NewHost() without setting MILL_CLIPBOARD_HOST_OK in the same file -- this would panic at test time; see internal/adapters/clipboard's own NewHost doc comment for the deliberate real-pasteboard-test seam"
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

if ((violations > 0)); then
  echo "error: $violations test-side-effect violation(s) -- see .claude/rules/testing.md's clipboard sentence and goal 0356." >&2
  exit 1
fi

echo "test-side-effects: no violations"
