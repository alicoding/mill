#!/usr/bin/env bash
# Proves gocache-trim.sh's safety properties: the busy-process guard
# skips for a real go BUILD-shaped subcommand, even on a bare runner
# with no hardcache installed (the guard runs before the hardcache
# lookup, never after); the regex it matches on excludes gopls (the
# permanently-running language server) and a bare `go env`; --dry-run
# never requires hardcache to be installed; and the LaunchAgent plist
# gocache-trim-setup.sh writes is well-formed. The launchd/plutil half
# is macOS-only; a Linux runner (CI's non-macOS jobs) SKIPs it with a
# clear line rather than failing.
#
# The gopls/go-env exclusion is asserted as a pure string match against
# the script's own computed regex (MILL_GOCACHE_PRINT_REGEX=1), never
# by spawning a fake process and reading the live process table: this
# machine routinely has real `go build`/`go test` processes running
# from unrelated concurrent work, which would make a live-process
# assertion here fail for a reason unrelated to the property under
# test (the real ambient process, not the fake one, triggering the
# guard). The positive case (a fake `go build` blocks) doesn't have
# this problem -- an ambient real match would only make it pass for an
# equally-valid reason -- so it stays a live integration check.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

trim="./scripts/dev/gocache-trim.sh"
setup="./scripts/dev/gocache-trim-setup.sh"
fails=0

# spawn_fake <argv0-with-embedded-args> -- exec -a accepts any string
# as argv[0], including one with an internal space, which is the
# simplest portable way to make a throwaway `sleep` process show up in
# `ps`/`pgrep -f` output as if its full command line were e.g. "go
# build" without actually invoking the go tool.
fake_pid=""
spawn_fake() {
  exec -a "$1" sleep 20 &
  fake_pid=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -f "$1" >/dev/null 2>&1 && break
    sleep 0.2
  done
}
kill_fake() {
  [ -n "$fake_pid" ] && kill "$fake_pid" 2>/dev/null
  wait "$fake_pid" 2>/dev/null || true
  fake_pid=""
}
trap kill_fake EXIT

# 1. A fake `go build` blocks the trim, EVEN WHEN hardcache isn't
# installed (HOME points at an empty scratch dir, same trick check 2
# below uses) -- proves the guard runs before, not after, the
# hardcache lookup: skip is the right answer either way.
# MILL_GOCACHE_GUARD_NAMED_PROCS="" excludes only the named-binary
# guard (golangci-lint/wails3/lefthook): this selftest itself typically
# runs AS a lefthook pre-commit job, so a real lefthook process is
# always present in that context and would otherwise mask which guard
# actually fired. The go-subcommand regex stays at its real default --
# that's the behavior under test.
scratch="$(mktemp -d)"
clean_path="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '/go/bin$' | paste -sd: -)"
spawn_fake "go build"
out="$(HOME="$scratch" PATH="$clean_path" MILL_GOCACHE_GUARD_NAMED_PROCS="" bash "$trim" 2>&1)"
kill_fake
if echo "$out" | grep -q "skipping -- a go build/test/vet/generate/install/run is running"; then
  echo "PASS: guard skips while a go build/test/.../run subcommand is running, hardcache installed or not"
else
  echo "FAIL: guard did not skip for a fake 'go build' process without hardcache -- got: $out" >&2
  fails=$((fails + 1))
fi
rm -rf "$scratch"

# 1b. gopls -- which runs permanently on a dev machine (the IDE) -- and
# a bare `go env` must NEVER match the go-subcommand regex. Pure string
# assertion against the script's own computed pattern (see the header
# comment for why this isn't a live-process check).
regex="$(MILL_GOCACHE_PRINT_REGEX=1 bash "$trim")"
for cmdline in "go build ./..." "go test ./..."; do
  if printf '%s' "$cmdline" | grep -qE "$regex"; then
    echo "PASS: the go-subcommand regex matches '$cmdline'"
  else
    echo "FAIL: the go-subcommand regex does not match '$cmdline'" >&2
    fails=$((fails + 1))
  fi
done
for cmdline in "gopls" "go env GOCACHE" "go version"; do
  if printf '%s' "$cmdline" | grep -qE "$regex"; then
    echo "FAIL: the go-subcommand regex incorrectly matches '$cmdline'" >&2
    fails=$((fails + 1))
  else
    echo "PASS: the go-subcommand regex does not match '$cmdline'"
  fi
done

# 2. --dry-run exits 0 and prints the install line when hardcache is
# not on PATH -- simulate by pointing HOME at an empty scratch dir (so
# $HOME/go/bin/hardcache resolves to nothing) and stripping the real
# hardcache off PATH. Both guard overrides are cleared for this call:
# this selftest itself typically runs AS a lefthook pre-commit job, so
# a real lefthook process is always present and would otherwise mask
# this code path behind the guard's "skipping" exit, passing the
# exit-code check for the wrong reason.
scratch="$(mktemp -d)"
clean_path="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '/go/bin$' | paste -sd: -)"
dryrun_out="$(mktemp)"
if HOME="$scratch" PATH="$clean_path" MILL_GOCACHE_GUARD_NAMED_PROCS="" MILL_GOCACHE_GUARD_GO_REGEX="" bash "$trim" --dry-run >"$dryrun_out" 2>&1; then
  if grep -q "not installed" "$dryrun_out"; then
    echo "PASS: --dry-run exits 0 and reports the install line without hardcache installed"
  else
    echo "FAIL: --dry-run exited 0 but did not reach the no-hardcache path -- got: $(cat "$dryrun_out")" >&2
    fails=$((fails + 1))
  fi
else
  echo "FAIL: --dry-run failed without hardcache installed -- $(cat "$dryrun_out")" >&2
  fails=$((fails + 1))
fi
rm -f "$dryrun_out"
rm -rf "$scratch"

# 3. The LaunchAgent plist is well-formed.
if [ "$(uname -s)" != "Darwin" ] || ! command -v plutil >/dev/null 2>&1; then
  echo "SKIP: plist lint needs plutil (macOS-only) -- not available on this runner"
else
  plist_tmp="$(mktemp)"
  bash "$setup" --print-plist >"$plist_tmp"
  if plutil -lint "$plist_tmp" >/dev/null 2>&1; then
    echo "PASS: LaunchAgent plist is well-formed (plutil -lint)"
  else
    echo "FAIL: LaunchAgent plist failed plutil -lint" >&2
    fails=$((fails + 1))
  fi
  rm -f "$plist_tmp"
fi

if ((fails > 0)); then
  echo "gocache-trim-selftest: $fails failure(s)" >&2
  exit 1
fi
echo "gocache-trim-selftest: all checks passed"
