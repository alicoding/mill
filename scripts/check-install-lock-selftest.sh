#!/usr/bin/env bash
# Probes scripts/with-install-lock.sh's contract (goal 0403 S2c) so an
# edit to the lock can't silently stop serializing installed-app
# passes or stop reclaiming a dead holder: two concurrent wrapped
# invocations never run their bodies overlapped, a holder killed
# without releasing is reclaimed by the next contender instead of
# blocking it, a contender that waits past MILL_INSTALL_LOCK_WAIT
# exits 75, and an --acquire/--release pair round-trips the lock
# directory's lifecycle.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
script="$repo_root/scripts/with-install-lock.sh"
work="$(mktemp -d)"
fails=0

cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1" >&2
  fails=$((fails + 1))
}

# --- two concurrent invocations serialise -----------------------------
serialize_dir="$work/serialize"
mkdir -p "$serialize_dir"
lockdir="$serialize_dir/lock"
log="$serialize_dir/order.log"
: > "$log"
(
  MILL_INSTALL_LOCK_DIR="$lockdir" "$script" bash -c \
    "echo 'A acquire' >> '$log'; sleep 0.4; echo 'A release' >> '$log'"
) &
pid_a=$!
sleep 0.05
(
  MILL_INSTALL_LOCK_DIR="$lockdir" "$script" bash -c \
    "echo 'B acquire' >> '$log'; sleep 0.4; echo 'B release' >> '$log'"
) &
pid_b=$!
wait "$pid_a" "$pid_b"

lines=()
while IFS= read -r line; do
  lines+=("$line")
done < "$log"
if [ "${#lines[@]}" -ne 4 ]; then
  fail "serialize: expected 4 log lines, got ${#lines[@]}: ${lines[*]-}"
else
  first_letter="${lines[0]%% *}"
  second_letter="${lines[1]%% *}"
  third_letter="${lines[2]%% *}"
  fourth_letter="${lines[3]%% *}"
  ok=true
  [ "${lines[0]#* }" = "acquire" ] || ok=false
  [ "${lines[1]#* }" = "release" ] || ok=false
  [ "${lines[2]#* }" = "acquire" ] || ok=false
  [ "${lines[3]#* }" = "release" ] || ok=false
  [ "$first_letter" = "$second_letter" ] || ok=false
  [ "$third_letter" = "$fourth_letter" ] || ok=false
  [ "$first_letter" != "$third_letter" ] || ok=false
  if [ "$ok" != true ]; then
    fail "serialize: expected one holder's full acquire/release pair before the other's, got: ${lines[*]}"
  fi
fi

# --- a holder that dies releases (stale reclaim) -----------------------
stale_dir="$work/stale"
mkdir -p "$stale_dir"
lockdir="$stale_dir/lock"
MILL_INSTALL_LOCK_DIR="$lockdir" "$script" sleep 3 &
holder_pid=$!
waited=0
while [ ! -f "$lockdir/pid" ] && [ "$waited" -lt 50 ]; do
  sleep 0.1
  waited=$((waited + 1))
done
[ -f "$lockdir/pid" ] || fail "stale: holder never recorded its PID"
kill -9 "$holder_pid" 2>/dev/null || true
wait "$holder_pid" 2>/dev/null || true
start=$(date +%s)
if ! MILL_INSTALL_LOCK_DIR="$lockdir" "$script" true; then
  fail "stale: a reclaimed lock should let the next caller through"
fi
elapsed=$(( $(date +%s) - start ))
if [ "$elapsed" -ge 3 ]; then
  fail "stale: reclaim took ${elapsed}s -- expected an immediate reclaim, not a wait for the dead holder's own sleep"
fi

# --- an initializer killed between mkdir and pid write is reclaimable ------
empty_dir="$work/empty"
mkdir -p "$empty_dir/lock"
if ! MILL_INSTALL_LOCK_DIR="$empty_dir/lock" "$script" true; then
  fail "empty: an abandoned pre-PID lock directory should be reclaimed"
fi
[ -d "$empty_dir/lock" ] && fail "empty: reclaimed wrapped lock should be released"

# --- the bounded wait exits 75 -----------------------------------------
bounded_dir="$work/bounded"
mkdir -p "$bounded_dir"
lockdir="$bounded_dir/lock"
MILL_INSTALL_LOCK_DIR="$lockdir" "$script" sleep 30 &
holder_pid=$!
waited=0
while [ ! -d "$lockdir" ] && [ "$waited" -lt 50 ]; do
  sleep 0.1
  waited=$((waited + 1))
done
[ -d "$lockdir" ] || fail "bounded: holder never created the lock directory"
set +e
MILL_INSTALL_LOCK_DIR="$lockdir" MILL_INSTALL_LOCK_WAIT=2 "$script" true
rc=$?
set -e
kill "$holder_pid" 2>/dev/null || true
wait "$holder_pid" 2>/dev/null || true
if [ "$rc" -ne 75 ]; then
  fail "bounded: expected exit 75 on a timed-out wait, got $rc"
fi

# --- --acquire / --release round-trips the lock directory --------------
pair_dir="$work/pair"
mkdir -p "$pair_dir"
lockdir="$pair_dir/lock"
MILL_INSTALL_LOCK_DIR="$lockdir" "$script" --acquire
[ -d "$lockdir" ] || fail "acquire: expected the lock directory to exist after --acquire"
MILL_INSTALL_LOCK_DIR="$lockdir" "$script" --release
[ -d "$lockdir" ] && fail "release: expected the lock directory to be gone after --release"

# --- a nested acquire (e.g. the skill holding --acquire, then shelling
# out to `task install:app`, which acquires the same lock internally)
# never blocks on its own outer hold, and its --release never releases
# a lock it doesn't own -----------------------------------------------
nest_dir="$work/nest"
mkdir -p "$nest_dir"
lockdir="$nest_dir/lock"
MILL_INSTALL_LOCK_DIR="$lockdir" "$script" --acquire
outer_holder="$(cat "$lockdir/pid")"
# The trailing `echo done` after --release matters: without a command
# following it, bash's own tail-call exec optimization can replace the
# nested shell's process image with the release invocation itself,
# reusing the OUTER script's PID as its $PPID and masking exactly the
# bug this case exists to catch.
nested_out="$(bash -c "MILL_INSTALL_LOCK_DIR='$lockdir' '$script' --acquire && echo nested-acquire-ok; MILL_INSTALL_LOCK_DIR='$lockdir' '$script' --release; echo done")"
if [ "$nested_out" != "$(printf 'nested-acquire-ok\ndone')" ]; then
  fail "nested: expected the nested acquire to no-op through immediately, got: $nested_out"
fi
if [ "$(cat "$lockdir/pid" 2>/dev/null || true)" != "$outer_holder" ]; then
  fail "nested: the outer holder's PID should be unchanged after a nested acquire/release"
fi
MILL_INSTALL_LOCK_DIR="$lockdir" "$script" --release
[ -d "$lockdir" ] && fail "nested: the outer release should remove the lock the nested calls left alone"

if [ "$fails" -gt 0 ]; then
  echo "check-install-lock-selftest: $fails check(s) failed" >&2
  exit 1
fi

echo "check-install-lock-selftest: ok"
