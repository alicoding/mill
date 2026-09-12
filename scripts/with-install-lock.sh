#!/usr/bin/env bash
# Serializes installed-app passes machine-wide: `task install:app` and
# the drive-installed-app skill's quit->install->drive->relaunch pass
# share ONE lock, so two concurrent passes never clobber the same
# /Applications/Mill.app bundle mid-install or kill each other's
# launched process. A SEPARATE lock file from with-gate-lock.sh's
# build/test slot -- an install pass and a heavy gate suite run
# concurrently without conflict. Same mkdir(2)-atomic primitive as
# with-gate-lock.sh / frontend/e2e/fixtures/e2eSlotLock.ts: exactly one
# concurrent caller wins the lock directory.
#
# Two usage shapes:
#   with-install-lock.sh <cmd...>   Wraps ONE live process for its
#                                    whole lifetime -- the lock is keyed
#                                    by this script's own PID ($$),
#                                    held via a trap, and released when
#                                    the wrapped command exits.
#   with-install-lock.sh --acquire  Spans a multi-step pass with no
#   with-install-lock.sh --release  single live process holding it
#                                    (the drive-installed-app skill's
#                                    quit/install/drive/relaunch steps
#                                    each run as their own process) --
#                                    keyed by the CALLER'S PPID, since
#                                    every step of one pass shares the
#                                    same parent shell (or `task` run)
#                                    for its whole duration and dies
#                                    with it. --release only removes a
#                                    lock this same parent still owns.
#
# A holder whose recorded PID is no longer alive is stale and reclaimed
# rather than waited out. Reentrant: `task install:app` acquires this
# SAME lock internally, so a caller who already holds it (the skill's
# --acquire, then a later step shells out to `task install:app`) would
# otherwise deadlock waiting on its own hold -- a recorded holder that
# is an ANCESTOR process of the current caller is treated as already
# held, never re-waited-on, and the inner --release correctly no-ops
# (its PPID never matches the outer holder), leaving the outer pass to
# release it.
set -euo pipefail

lock="${MILL_INSTALL_LOCK_DIR:-${TMPDIR:-/tmp}/mill-install-app.lock}"
lock="${lock%/}"
max_wait="${MILL_INSTALL_LOCK_WAIT:-1200}"

# is_ancestor <target-pid> <start-pid>: true if target-pid appears in
# start-pid's own parent chain (including start-pid itself). Bounded to
# 200 hops so a broken ps/ppid chain can never loop forever.
is_ancestor() {
  local target="$1" pid="$2" ppid hops=0
  while [ "$hops" -lt 200 ]; do
    if [ "$pid" = "$target" ]; then
      return 0
    fi
    [ "$pid" != "1" ] || return 1
    ppid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
    [ -n "$ppid" ] || return 1
    pid="$ppid"
    hops=$((hops + 1))
  done
  return 1
}

held_by_ancestor() {
  local holder
  holder="$(cat "$lock/pid" 2>/dev/null || true)"
  [ -n "$holder" ] || return 1
  kill -0 "$holder" 2>/dev/null || return 1
  is_ancestor "$holder" "$$"
}

wait_for_lock() {
  local waited=0 holder
  while ! mkdir "$lock" 2>/dev/null; do
    holder="$(cat "$lock/pid" 2>/dev/null || true)"
    if [ -z "$holder" ]; then
      # mkdir and writing pid are separate operations. If the creator dies
      # between them, rmdir reclaims the still-empty directory atomically; if
      # the creator writes first, rmdir fails and this contender keeps waiting.
      if rmdir "$lock" 2>/dev/null; then
        continue
      fi
      holder="$(cat "$lock/pid" 2>/dev/null || true)"
    fi
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
      rm -rf "$lock"
      continue
    fi
    if [ "$waited" -ge "$max_wait" ]; then
      echo "with-install-lock: waited ${max_wait}s for $lock (held by pid ${holder:-?}); giving up -- installed pass pending" >&2
      exit 75
    fi
    if [ "$waited" -eq 0 ]; then
      echo "with-install-lock: waiting for another installed-app pass to finish (pid ${holder:-?})" >&2
    fi
    sleep 5
    waited=$((waited + 5))
  done
}

case "${1:-}" in
  --acquire)
    held_by_ancestor && exit 0
    wait_for_lock
    echo "$PPID" > "$lock/pid"
    ;;
  --release)
    holder="$(cat "$lock/pid" 2>/dev/null || true)"
    if [ "$holder" = "$PPID" ]; then
      rm -rf "$lock"
    fi
    ;;
  "")
    echo "usage: $0 <cmd...> | --acquire | --release" >&2
    exit 2
    ;;
  *)
    if held_by_ancestor; then
      "$@"
      exit $?
    fi
    wait_for_lock
    echo "$$" > "$lock/pid"
    trap 'rm -rf "$lock"' EXIT
    "$@"
    ;;
esac
