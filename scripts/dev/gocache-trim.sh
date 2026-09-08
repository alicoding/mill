#!/usr/bin/env bash
# Go's build cache is age-trimmed only, with no size cap (golang/go#69565
# open), and `go clean -cache` races a live build -- deleting an object
# another process is reading corrupts that build (golang/go#31948). This
# script guards against both: it skips entirely while a go/gopls/
# golangci-lint/wails3/lefthook process is running anywhere on the
# machine, and otherwise delegates size-capped LRU trimming to hardcache
# (github.com/AlekSi/hardcache), which operates on the standard GOCACHE
# directory Go itself uses.
set -uo pipefail

dry_run=0
[ "${1:-}" = "--dry-run" ] && dry_run=1

log_file="$HOME/Library/Logs/mill-gocache-trim.log"
# MILL_GOCACHE_GUARD_PROCS is a selftest-only override: the selftest
# runs itself as a lefthook pre-commit job, so a real lefthook process
# is always present in that context and would mask the no-hardcache
# code path the "missing binary" check exercises. Unset in production
# (the LaunchAgent invocation never sets it), where the default five
# names apply.
guard_procs="${MILL_GOCACHE_GUARD_PROCS-go gopls golangci-lint wails3 lefthook}"

for proc in $guard_procs; do
  if pgrep -x "$proc" >/dev/null 2>&1; then
    echo "gocache-trim: skipping -- $proc is running"
    exit 0
  fi
done

hardcache_bin=""
if command -v hardcache >/dev/null 2>&1; then
  hardcache_bin="$(command -v hardcache)"
elif [ -x "$HOME/go/bin/hardcache" ]; then
  hardcache_bin="$HOME/go/bin/hardcache"
fi

if [ -z "$hardcache_bin" ]; then
  echo "gocache-trim: hardcache not installed -- run: go install github.com/AlekSi/hardcache@v0.2.0"
  exit 0
fi

gocache_dir="$(go env GOCACHE)"
max_size="${MILL_GOCACHE_MAX:-8GB}"
unused_for="${MILL_GOCACHE_UNUSED:-5d}"

size_of() {
  du -sh "$1" 2>/dev/null | cut -f1
}

before="$(size_of "$gocache_dir")"

if [ "$dry_run" -eq 1 ]; then
  echo "gocache-trim: dry-run -- would run: $hardcache_bin local trim --unused-for=$unused_for --max-size=$max_size --dir=$gocache_dir (current size: ${before:-unknown})"
  exit 0
fi

"$hardcache_bin" local trim --unused-for="$unused_for" --max-size="$max_size" --dir="$gocache_dir"

after="$(size_of "$gocache_dir")"

mkdir -p "$(dirname "$log_file")"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) before=${before:-unknown} after=${after:-unknown} unused-for=$unused_for max-size=$max_size dir=$gocache_dir" >>"$log_file"
