#!/usr/bin/env bash
# Exercises executable-path selection with real same-basename processes. Every
# process signalled here was spawned by this test from its disposable tree.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
stop_script="$repo_root/scripts/stop-installed-app.sh"
taskfile="$repo_root/Taskfile.yml"
work="$(mktemp -d "${TMPDIR:-/tmp}/mill-installed-process-selftest.XXXXXX")"
fails=0
owned_pids=""

fixture_pid_matches() {
  local pid="$1" executable
  for executable in "$work/target/mill" "$work/unrelated/mill"; do
    if /usr/sbin/lsof -p "$pid" -a -d txt -Fp -- "$executable" 2>/dev/null | grep -q "^p${pid}$"; then
      return 0
    fi
  done
  return 1
}

cleanup() {
  local pid
  for pid in $owned_pids; do
    if fixture_pid_matches "$pid"; then
      /bin/kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  sleep 0.1
  for pid in $owned_pids; do
    if fixture_pid_matches "$pid"; then
      /bin/kill -KILL "$pid" 2>/dev/null || true
    fi
    wait "$pid" 2>/dev/null || true
  done
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1" >&2
  fails=$((fails + 1))
}

spawn_fixture() {
  local executable="$1" mode="${2:-exit}"
  "$executable" "$mode" &
  spawned_pid=$!
  owned_pids="$owned_pids $spawned_pid"
}

wait_for_identity() {
  local executable="$1" pid="$2" attempts=0
  while [ "$attempts" -lt 50 ]; do
    if /usr/sbin/lsof -p "$pid" -a -d txt -Fp -- "$executable" 2>/dev/null | grep -q "^p${pid}$"; then
      return 0
    fi
    sleep 0.1
    attempts=$((attempts + 1))
  done
  return 1
}

mkdir -p "$work/target" "$work/unrelated" "$work/absent"
cat >"$work/fixture.c" <<'C'
#include <signal.h>
#include <string.h>
#include <unistd.h>

static volatile sig_atomic_t done = 0;

static void handle_term(int signal_number) {
  (void)signal_number;
  done = 1;
}

int main(int argc, char **argv) {
  if (argc > 1 && strcmp(argv[1], "ignore") == 0) {
    signal(SIGTERM, SIG_IGN);
  } else {
    signal(SIGTERM, handle_term);
  }
  while (!done) {
    pause();
  }
  return 0;
}
C
cc "$work/fixture.c" -o "$work/fixture"
cp "$work/fixture" "$work/target/mill"
cp "$work/fixture" "$work/unrelated/mill"

# The exact installed path must be stopped before bundle replacement, with no
# basename-wide pkill left in install:app.
install_block="$(sed -n '/^  install:app:/,/^  run:/p' "$taskfile")"
expected_call='scripts/stop-installed-app.sh /Applications/Mill.app/Contents/MacOS/{{.APP_NAME}}'
if ! printf '%s\n' "$install_block" | grep -Fq "$expected_call"; then
  fail "Taskfile: install:app does not pass the canonical installed executable"
fi
if printf '%s\n' "$install_block" | grep -Eq 'pkill|killall'; then
  fail "Taskfile: install:app still contains basename-wide process termination"
fi
call_line="$(printf '%s\n' "$install_block" | grep -nF "$expected_call" | cut -d: -f1 | head -1)"
replace_line="$(printf '%s\n' "$install_block" | grep -nF 'rm -rf /Applications/Mill.app' | cut -d: -f1 | head -1)"
if [ -z "$call_line" ] || [ -z "$replace_line" ] || [ "$call_line" -ge "$replace_line" ]; then
  fail "Taskfile: installed-process refusal must occur before bundle replacement"
fi

# A selected executable exits while an unrelated executable with the same
# basename survives.
spawn_fixture "$work/target/mill"
target_pid="$spawned_pid"
spawn_fixture "$work/unrelated/mill"
unrelated_pid="$spawned_pid"
wait_for_identity "$work/target/mill" "$target_pid" || fail "target process was not discoverable by executable identity"
wait_for_identity "$work/unrelated/mill" "$unrelated_pid" || fail "unrelated process was not discoverable by executable identity"
if ! "$stop_script" "$work/target/mill"; then
  fail "target: matching process should exit cleanly"
fi
wait "$target_pid" 2>/dev/null || true
if /bin/kill -0 "$target_pid" 2>/dev/null; then
  fail "target: matching process survived TERM"
fi
if ! /bin/kill -0 "$unrelated_pid" 2>/dev/null; then
  fail "target: unrelated same-basename process was signalled"
fi

# Missing files, regular files with no process, and already-exited processes
# are all clean first-install/already-stopped cases.
if ! "$stop_script" "$work/absent/mill"; then
  fail "absent: missing target should succeed"
fi
if (cd "$work" && "$stop_script" target/mill 2>"$work/relative.err"); then
  fail "argument: a relative executable path should refuse"
fi
if "$stop_script" "$work/target" 2>"$work/nonregular.err"; then
  fail "non-regular: an existing directory should refuse"
fi
if ! "$stop_script" "$work/target/mill"; then
  fail "no-process: regular target with no process should succeed"
fi
spawn_fixture "$work/target/mill"
exited_pid="$spawned_pid"
wait_for_identity "$work/target/mill" "$exited_pid" || fail "already-exited fixture was not discoverable"
/bin/kill -TERM "$exited_pid"
wait "$exited_pid" 2>/dev/null || true
if ! "$stop_script" "$work/target/mill"; then
  fail "already-exited: clean race should succeed"
fi

# Refusal is observable by the caller: a TERM-ignoring target stays alive and
# shell continuation (the bundle-replacement shape) is never reached.
spawn_fixture "$work/target/mill" ignore
ignoring_pid="$spawned_pid"
wait_for_identity "$work/target/mill" "$ignoring_pid" || fail "TERM-ignoring fixture was not discoverable"
marker="$work/replacement-reached"
set +e
MILL_STOP_INSTALLED_APP_TEST_WAIT_SECONDS=1 "$stop_script" "$work/target/mill" 2>"$work/refusal.err" && touch "$marker"
refusal_rc=$?
set -e
if [ "$refusal_rc" -eq 0 ]; then
  fail "refusal: TERM-ignoring target should return nonzero"
fi
if [ -e "$marker" ]; then
  fail "refusal: replacement continuation ran after a non-exiting target"
fi
if ! /bin/kill -0 "$ignoring_pid" 2>/dev/null; then
  fail "refusal: helper escalated beyond TERM"
fi
if ! grep -q 'did not exit' "$work/refusal.err"; then
  fail "refusal: expected a bounded-exit diagnostic"
fi
/bin/kill -KILL "$ignoring_pid" 2>/dev/null || true
wait "$ignoring_pid" 2>/dev/null || true

# The callable test seam proves inspection failures are refusals and never
# become permission-by-silence fallbacks.
cat >"$work/failing-lsof" <<'SH'
#!/usr/bin/env bash
echo "fixture inspection failure" >&2
exit 2
SH
chmod +x "$work/failing-lsof"
marker="$work/inspection-continuation-reached"
set +e
MILL_STOP_INSTALLED_APP_TEST_LSOF="$work/failing-lsof" "$stop_script" "$work/target/mill" 2>"$work/inspection.err" && touch "$marker"
inspection_rc=$?
set -e
if [ "$inspection_rc" -eq 0 ]; then
  fail "inspection: lsof failure should return nonzero"
fi
if [ -e "$marker" ]; then
  fail "inspection: replacement continuation ran after discovery failed"
fi
if ! grep -q 'fixture inspection failure' "$work/inspection.err"; then
  fail "inspection: lsof stderr was not retained"
fi

if [ "$fails" -gt 0 ]; then
  echo "check-installed-process-selftest: $fails check(s) failed" >&2
  exit 1
fi

echo "check-installed-process-selftest: ok"
