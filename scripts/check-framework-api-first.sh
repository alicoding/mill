#!/usr/bin/env bash
# Enforces .claude/rules/architecture.md's "Adopting a dependency means
# reading its whole API" paragraph: any hand-written Go file that reaches
# for cgo/Objective-C to talk to the OS directly must carry a comment
# stating what the current Wails v3 API was checked for and found to
# lack -- so a future capability the SDK gains doesn't sit hand-rolled
# next to it unnoticed. Run by lefthook (pre-commit) and CI's
# framework-api-first job -- one script both call, same non-drift shape
# as check-comment-hygiene.sh.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

wails_version="$(grep -E '^\s*github\.com/wailsapp/wails/v3 ' go.mod | awk '{print $2}')"
if [[ -z "$wails_version" ]]; then
  echo "framework-api-first: could not find github.com/wailsapp/wails/v3 in go.mod" >&2
  exit 1
fi

# Same hand-written-source scope as check-loc.sh: generated bindings and
# the vendored gomobile scaffold are not code Mill audits for API reach.
exclude_regex='^(frontend/bindings/|frontend/plugin-sdk/|build/ios/|build/android/|frontend/dist/|frontend/node_modules/)'

cgo_marker='import "C"|^[[:space:]]*#cgo |^[[:space:]]*#import <|^[[:space:]]*#include <'
audit_line_regex='^[[:space:]]*//[[:space:]]*framework-api-audit: wails/v3@([^[:space:]]+) lacks (.+)$'

violations=0
while IFS= read -r -d '' file; do
  case "$file" in
    *_test.go) continue ;;
    *.go) ;;
    *) continue ;;
  esac
  if [[ "$file" =~ $exclude_regex ]]; then
    continue
  fi
  if ! grep -qE "$cgo_marker" "$file"; then
    continue
  fi

  found=0
  lineno=0
  while IFS= read -r line; do
    lineno=$((lineno + 1))
    if [[ "$line" =~ $audit_line_regex ]]; then
      found=1
      line_version="${BASH_REMATCH[1]}"
      if [[ "$line_version" != "$wails_version" ]]; then
        echo "framework-api-first: $file:$lineno: stale audit: names v3@$line_version, go.mod is v3@$wails_version -- re-audit against the vendored source"
        violations=$((violations + 1))
      fi
    fi
  done < "$file"

  if [[ "$found" -eq 0 ]]; then
    echo "framework-api-first: $file: missing audit line"
    violations=$((violations + 1))
  fi
done < <(git ls-files -z -- '*.go')

if [[ "$violations" -gt 0 ]]; then
  echo
  echo "framework-api-first: $violations violation(s). Every hand-written cgo/Objective-C"
  echo "adapter needs a 'framework-api-audit: wails/v3@$wails_version lacks <what>' comment"
  echo "line, pinned to go.mod's Wails version. See .claude/rules/architecture.md."
  exit 1
fi

echo "framework-api-first: 0 violation(s) against wails/v3@$wails_version."
