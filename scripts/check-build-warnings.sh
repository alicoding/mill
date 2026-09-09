#!/usr/bin/env bash
# Enforces goal 0419 S1: `go build`/`go vet` printing anything containing
# "warning" on stderr (ld, clang/cgo, or Go's own vet) is a red gate, not
# a note in the log -- the class the desktop link's own deployment-target
# mismatch shipped silently until this goal. Sources
# scripts/lib/build-env.sh for the one macOS target every other Go
# build/test gate already uses. Run by lefthook (the existing Go gate
# group) and CI's build-go job -- one script both call, same
# non-drift shape as check-comment-hygiene.sh.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
# shellcheck source=lib/build-env.sh
. scripts/lib/build-env.sh

out="$(mktemp -t mill-build-warnings)"
trap 'rm -f "$out"' EXIT

status=0
{ go build -o /dev/null . ; go vet . ./internal/... ; } >"$out" 2>&1 || status=$?

hits="$(grep -i 'warning' "$out" || true)"
if [ -n "$hits" ]; then
  echo "check-build-warnings: go build/go vet printed a warning:" >&2
  echo "$hits" >&2
  exit 1
fi

if [ "$status" -ne 0 ]; then
  echo "check-build-warnings: go build/go vet failed (not a warning -- a real build error):" >&2
  cat "$out" >&2
  exit "$status"
fi

exit 0
