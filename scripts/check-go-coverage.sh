#!/usr/bin/env bash
# Go coverage floor (goal 0080): same ratchet philosophy as vitest's
# thresholds.autoUpdate -- the floor is the measured baseline at
# adoption and only ever moves up, by editing FLOOR here in the same
# commit that raises real coverage. Run from repo root; expects a
# coverprofile produced by the caller (lefthook/CI pass one so the
# test run isn't paid twice).
set -euo pipefail
PROFILE="${1:?usage: check-go-coverage.sh <coverprofile>}"
# The floor is the MINIMUM across enforcing environments. Lowered back
# to 71.0 (was briefly 71.5) after the 71.5 floor left no inter-PR
# margin: two consecutive same-night PRs measured 71.9% then 71.4% on
# CI's own runner -- the total moves a few tenths per PR just from
# ordinary line-count churn, so the floor must absorb THAT variance on
# top of the existing local-vs-CI environment variance, not just the
# latter. Re-raise only when the CI number climbs clear of the floor by
# more than the observed ~0.5pt inter-PR swing, never on a single
# comfortably-green reading.
FLOOR="75.0"
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
