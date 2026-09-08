#!/usr/bin/env bash
# Proves gocache-trim.sh's two safety properties -- the busy-process
# guard actually skips, and --dry-run never requires hardcache to be
# installed -- plus that the LaunchAgent plist gocache-trim-setup.sh
# writes is well-formed. The launchd/plutil half is macOS-only; a Linux
# runner (CI's non-macOS jobs) SKIPs it with a clear line rather than
# failing.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

trim="./scripts/dev/gocache-trim.sh"
setup="./scripts/dev/gocache-trim-setup.sh"
fails=0

# 1. The guard skips when a process named "go" is running, even if it
# isn't really the go tool -- the guard matches by process name only.
fake_pid=""
cleanup() {
  [ -n "$fake_pid" ] && kill "$fake_pid" 2>/dev/null || true
}
trap cleanup EXIT

exec -a go sleep 5 &
fake_pid=$!
# pgrep needs the renamed process to be visible; give it a moment.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  pgrep -x go >/dev/null 2>&1 && break
  sleep 0.2
done

out="$(bash "$trim" 2>&1)"
if ! echo "$out" | grep -q "skipping -- go is running"; then
  echo "FAIL: guard did not skip with a fake 'go' process running -- got: $out" >&2
  fails=$((fails + 1))
else
  echo "PASS: guard skips while a process named go is running"
fi

kill "$fake_pid" 2>/dev/null || true
wait "$fake_pid" 2>/dev/null || true
fake_pid=""
trap - EXIT

# 2. --dry-run exits 0 and prints the install line when hardcache is
# not on PATH -- simulate by pointing HOME at an empty scratch dir (so
# $HOME/go/bin/hardcache resolves to nothing) and stripping the real
# hardcache off PATH. MILL_GOCACHE_GUARD_PROCS="" disables the
# busy-process guard for this call: this selftest itself typically
# runs AS a lefthook pre-commit job, so a real lefthook process is
# already present and would otherwise mask this code path behind the
# guard's "skipping" exit, passing the exit-code check for the wrong
# reason.
scratch="$(mktemp -d)"
clean_path="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '/go/bin$' | paste -sd: -)"
dryrun_out="$(mktemp)"
if HOME="$scratch" PATH="$clean_path" MILL_GOCACHE_GUARD_PROCS="" bash "$trim" --dry-run >"$dryrun_out" 2>&1; then
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
