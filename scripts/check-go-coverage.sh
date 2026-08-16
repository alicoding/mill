#!/usr/bin/env bash
# Go coverage floor (goal 0080): same ratchet philosophy as vitest's
# thresholds.autoUpdate -- the floor is the measured baseline at
# adoption and only ever moves up, by editing FLOOR here in the same
# commit that raises real coverage. Run from repo root; expects a
# coverprofile produced by the caller (lefthook/CI pass one so the
# test run isn't paid twice).
set -euo pipefail
PROFILE="${1:?usage: check-go-coverage.sh <coverprofile>}"
# 69.5: the floor is the MINIMUM across enforcing environments -- the
# macOS CI runner measures 69.8 where a local desktop run measures
# 70.4 (build-tag paths differ slightly), and the floor must hold in
# the strictest one. Raise it here when the CI number climbs.
FLOOR="69.5"
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
