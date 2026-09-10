#!/usr/bin/env bash
# Go's build cache is age-trimmed only, with no size cap (golang/go#69565
# open), and `go clean -cache` races a live build -- deleting an object
# another process is reading corrupts that build (golang/go#31948). This
# script guards against both: it skips entirely while a go BUILD-shaped
# subcommand (build/test/vet/generate/install/run -- the ones that read
# or write cache objects) or a golangci-lint/wails3/lefthook process is
# running anywhere on the machine, and otherwise delegates size-capped
# LRU trimming to hardcache (github.com/AlekSi/hardcache), which
# operates on the standard GOCACHE directory Go itself uses.
#
# The guard matches the COMMAND, never any process merely named "go":
# gopls (the language server) and `go env`/`go version`-shaped calls
# never touch cache-object files, so they never block a trim -- gopls
# runs permanently on a dev machine, and treating its mere presence as
# "busy" would starve the trim forever. Go also bumps an object's mtime
# on every read, so an entry unused for the default --unused-for cutoff
# (24h) was not touched by any build in that window and is safe to
# evict even were a build somehow still running.
set -uo pipefail

dry_run=0
[ "${1:-}" = "--dry-run" ] && dry_run=1

log_file="${MILL_GOCACHE_LOG_FILE:-$HOME/Library/Logs/mill-gocache-trim.log}"
gobin="${MILL_GOCACHE_GOBIN:-$HOME/go/bin}"
# Selftest-only overrides: the selftest runs itself as a lefthook
# pre-commit job, so a real lefthook process is always present in that
# context and would mask the code paths under test behind an unrelated
# "skipping" exit. Both default to their production value when unset
# (the LaunchAgent invocation never sets either).
named_guard_procs="${MILL_GOCACHE_GUARD_NAMED_PROCS-golangci-lint wails3 lefthook}"
go_build_regex="${MILL_GOCACHE_GUARD_GO_REGEX-(^|/| )go[[:space:]]+(build|test|vet|generate|install|run)([[:space:]]|$)}"

# Selftest-only: print the computed regex and exit, so the selftest can
# assert what it matches/excludes by string comparison instead of
# duplicating this literal (which would drift silently).
if [ "${MILL_GOCACHE_PRINT_REGEX:-0}" = "1" ]; then
  echo "$go_build_regex"
  exit 0
fi

# The busy-process guard runs unconditionally before any hardcache
# lookup: whether or not hardcache is even installed, a live build in
# progress is always the reason to do nothing this cycle.
for proc in $named_guard_procs; do
  if pgrep -x "$proc" >/dev/null 2>&1; then
    echo "gocache-trim: skipping -- $proc is running"
    exit 0
  fi
done

if [ -n "$go_build_regex" ] && pgrep -f "$go_build_regex" >/dev/null 2>&1; then
  echo "gocache-trim: skipping -- a go build/test/vet/generate/install/run is running"
  exit 0
fi

hardcache_bin=""
if command -v hardcache >/dev/null 2>&1; then
  hardcache_bin="$(command -v hardcache)"
elif [ -x "$gobin/hardcache" ]; then
  hardcache_bin="$gobin/hardcache"
fi

if [ -z "$hardcache_bin" ]; then
  echo "gocache-trim: hardcache not installed -- run: go install github.com/AlekSi/hardcache@v0.2.0"
  exit 0
fi

go_bin="${MILL_GOCACHE_GO:-}"
if [ -n "$go_bin" ]; then
  if [ ! -x "$go_bin" ]; then
    echo "gocache-trim: go executable not found or not executable: $go_bin" >&2
    exit 1
  fi
else
  go_bin="$(command -v go 2>/dev/null || true)"
  if [ -z "$go_bin" ]; then
    echo "gocache-trim: go executable not found on PATH" >&2
    exit 1
  fi
fi

if ! gocache_dir="$("$go_bin" env GOCACHE)"; then
  echo "gocache-trim: go env GOCACHE failed" >&2
  exit 1
fi
if [ -z "$gocache_dir" ]; then
  echo "gocache-trim: go env GOCACHE returned an empty path" >&2
  exit 1
fi
max_size="${MILL_GOCACHE_MAX:-8GB}"
unused_for="${MILL_GOCACHE_UNUSED:-24h}"

size_of() {
  du -sh "$1" 2>/dev/null | cut -f1
}

before="$(size_of "$gocache_dir")"

if [ "$dry_run" -eq 1 ]; then
  echo "gocache-trim: dry-run -- would run: $hardcache_bin local trim --unused-for=$unused_for --max-size=$max_size --dir=$gocache_dir (current size: ${before:-unknown})"
  exit 0
fi

"$hardcache_bin" local trim --unused-for="$unused_for" --max-size="$max_size" --dir="$gocache_dir"
status=$?
if [ "$status" -ne 0 ]; then
  echo "gocache-trim: hardcache failed with exit $status" >&2
  exit "$status"
fi

after="$(size_of "$gocache_dir")"

mkdir -p "$(dirname "$log_file")"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) before=${before:-unknown} after=${after:-unknown} unused-for=$unused_for max-size=$max_size dir=$gocache_dir" >>"$log_file"
