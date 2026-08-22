#!/usr/bin/env bash
# Go coverage floor (goal 0080): same ratchet philosophy as vitest's
# thresholds.autoUpdate -- the floor is the measured baseline at
# adoption and only ever moves up, by editing FLOOR here in the same
# commit that raises real coverage. Run from repo root; expects a
# coverprofile produced by the caller (lefthook/CI pass one so the
# test run isn't paid twice).
set -euo pipefail
PROFILE="${1:?usage: check-go-coverage.sh <coverprofile>}"
# The floor is the MINIMUM across enforcing environments -- raised here
# (goal 0101 slice 1, the aiclient tool-use + agentloopsvc addition) from
# 71.0 after a local run measured 72.3%; kept a hair below that so a
# stricter CI-runner measurement still has headroom, same margin
# reasoning as every prior raise of this constant. Raise it again here
# when the CI number climbs.
FLOOR="72.0"
TOTAL=$(go tool cover -func="$PROFILE" | awk '/^total:/ {gsub(/%/,"",$3); print $3}')
if [ -z "$TOTAL" ]; then
  echo "check-go-coverage: no total in $PROFILE" >&2
  exit 1
fi
awk -v t="$TOTAL" -v f="$FLOOR" 'BEGIN {
  if (t+0 < f+0) { printf "error: Go coverage %.1f%% is below the committed floor %.1f%%\n", t, f; exit 1 }
  if (t+0 > f+1.0) { printf "note: Go coverage %.1f%% exceeds the floor %.1f%% by >1pt -- raise FLOOR in scripts/check-go-coverage.sh\n", t, f }
  else { printf "Go coverage %.1f%% (floor %.1f%%)\n", t, f }
}'
