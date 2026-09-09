#!/usr/bin/env bash
# Enforces goal 0419 S1/S1c: `go build`/`go vet`/`go test`'s own compile
# step printing anything containing "warning" on stderr (ld, clang/cgo,
# or Go's own vet) is a red gate, not a note in the log -- the class the
# desktop link's own deployment-target mismatch shipped silently until
# this goal. Sources scripts/lib/build-env.sh for the one macOS target
# every other Go build/test gate already uses. Run by lefthook (the
# existing Go gate group) and CI's build-go job -- one script both
# call, same non-drift shape as check-comment-hygiene.sh.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
# shellcheck source=lib/build-env.sh
. scripts/lib/build-env.sh

out="$(mktemp -t mill-build-warnings)"
trap 'rm -f "$out"' EXIT

status=0
{
  go build -o /dev/null .
  go vet . ./internal/...
  # goal 0419 S1c: `go build .`'s own link order happens to put one of
  # Mill's own -mmacosx-version-min=12.0 cgo flags last on the external
  # linker's argv, so ld settles on 12.0 without help -- but a smaller
  # test binary (e.g. launchatlogin's, confirmed via `go test
  # -ldflags=-v`) can link a package set whose LAST occurrence is one
  # of Wails' own vendored -mmacosx-version-min=10.13 cgo files instead
  # (ld64 takes the last -mmacosx-version-min on the command line),
  # producing the "was built for newer macOS version (12.0) than being
  # linked (11.0)" class on stderr with an exit-0 `go test` run.
  # -extldflags pins the resolved target as the LAST flag Go's linker
  # itself appends, independent of package link order, without
  # touching build/*/Taskfile.yml's own -ldflags (those pass their own
  # value explicitly, superseding this one, and already link clean).
  go test -run '^$' -count=1 -ldflags='-extldflags=-mmacosx-version-min=12.0' ./internal/... .
} >"$out" 2>&1 || status=$?

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
