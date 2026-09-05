#!/usr/bin/env bash
# Runs one heavy local gate (go test -race, vitest) under a machine-wide
# slot so concurrent worktrees serialise instead of starving each other:
# a 16GB machine running several full suites at once fails on ENOSPC,
# OOM-killed subprocesses and timeouts that no single change caused.
# Same shape as frontend/e2e/fixtures/e2eSlotLock.ts (mkdir(2) is atomic,
# so exactly one caller wins the lock directory); CI never contends, so
# CI=true bypasses. A holder whose PID is gone is stale and reclaimed.
set -euo pipefail

if [ -n "${CI:-}" ] || [ -n "${MILL_GATE_LOCK_BYPASS:-}" ]; then
  exec "$@"
fi

lock="${MILL_GATE_LOCK_DIR:-${TMPDIR:-/tmp}/mill-gate-slot.lock}"
lock="${lock%/}"
max_wait="${MILL_GATE_LOCK_MAX_WAIT_SECONDS:-2700}"
waited=0

while ! mkdir "$lock" 2>/dev/null; do
  holder="$(cat "$lock/pid" 2>/dev/null || true)"
  if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
    rm -rf "$lock"
    continue
  fi
  if [ "$waited" -ge "$max_wait" ]; then
    echo "with-gate-lock: waited ${max_wait}s for $lock (held by pid ${holder:-?}); giving up" >&2
    exit 1
  fi
  if [ "$waited" -eq 0 ]; then
    echo "with-gate-lock: waiting for another worktree's gate to finish (pid ${holder:-?})" >&2
  fi
  sleep 10
  waited=$((waited + 10))
done

echo "$$" > "$lock/pid"
trap 'rm -rf "$lock"' EXIT
"$@"
