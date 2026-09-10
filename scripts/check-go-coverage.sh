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
MODULE=$(awk '/^module/ {print $2; exit}' go.mod 2>/dev/null || true)

# quarantined_packages lists every package whose _test.go carries the
# repo's CI-only-skip guard (`if os.Getenv("CI") != "" { t.Skip(...) }`)
# -- grepped fresh each run rather than a second hand-kept list, so a
# newly quarantined test is picked up automatically. A test skipped only
# on CI makes CI's own coverage total read LOWER than a local run's,
# which is exactly the gap goal 0413 S2's rider exists for: a floor
# raised from the local "raise FLOOR" hint failed a merge group once
# real CI measured 75.7% against a local 76.5% (#880).
quarantined_packages() {
  grep -rl 'os.Getenv("CI") != ""' internal --include='*_test.go' 2>/dev/null \
    | xargs -r -n1 dirname | sort -u
}

TOTAL=$(go tool cover -func="$PROFILE" | awk '/^total:/ {gsub(/%/,"",$3); print $3}')
if [ -z "$TOTAL" ]; then
  echo "check-go-coverage: no total in $PROFILE" >&2
  exit 1
fi

awk -v t="$TOTAL" -v f="$FLOOR" 'BEGIN {
  if (t+0 < f+0) { printf "error: Go coverage %.1f%% is below the committed floor %.1f%%\n", t, f; exit 1 }
}'

CLEARS_LOCAL=$(awk -v t="$TOTAL" -v f="$FLOOR" 'BEGIN { print (t+0 > f+1.0) ? 1 : 0 }')
if [ "$CLEARS_LOCAL" != "1" ] || [ -z "$MODULE" ]; then
  printf "Go coverage %.1f%% (floor %.1f%%)\n" "$TOTAL" "$FLOOR"
  exit 0
fi

# Only past this point -- the local reading already looks like it clears
# FLOOR by >1pt, the rare branch -- do we pay for a CI-equivalent
# recheck: re-measure just the quarantined packages under CI=true (so
# their own quarantined tests skip exactly as they do on the real
# runner) and splice that sub-profile's numbers into the total in place
# of the local, non-quarantined reading. Every other package's coverage
# is untouched.
PKGS=$(quarantined_packages)
CI_TOTAL="$TOTAL"
ADJUSTED=0
if [ -n "$PKGS" ]; then
  TOUCHED=0
  for pkg in $PKGS; do
    if grep -q "${MODULE}/${pkg}/" "$PROFILE" 2>/dev/null; then
      TOUCHED=1
    fi
  done
  if [ "$TOUCHED" = "1" ]; then
    GO_PKG_ARGS=""
    for pkg in $PKGS; do
      GO_PKG_ARGS="$GO_PKG_ARGS ./${pkg}/..."
    done
    SUBPROFILE="$(mktemp "${TMPDIR:-/tmp}/mill-cover-ci-sub.XXXXXX")"
    # shellcheck disable=SC2086
    if CI=true go test $GO_PKG_ARGS -race -coverprofile="$SUBPROFILE" >/dev/null 2>&1; then
      PATTERN=""
      for pkg in $PKGS; do
        PATTERN="${PATTERN}${MODULE}/${pkg}/|"
      done
      PATTERN="${PATTERN%|}"
      MERGED="$(mktemp "${TMPDIR:-/tmp}/mill-cover-ci-merged.XXXXXX")"
      echo "mode: set" > "$MERGED"
      tail -n +2 "$PROFILE" | grep -vE "^(${PATTERN})" >> "$MERGED" || true
      tail -n +2 "$SUBPROFILE" >> "$MERGED" || true
      CI_TOTAL=$(go tool cover -func="$MERGED" | awk '/^total:/ {gsub(/%/,"",$3); print $3}')
      ADJUSTED=1
      rm -f "$MERGED"
    fi
    rm -f "$SUBPROFILE"
  fi
fi

if [ "$ADJUSTED" = "1" ]; then
  awk -v t="$TOTAL" -v ct="$CI_TOTAL" -v f="$FLOOR" 'BEGIN {
    if (ct+0 > f+1.0) { printf "note: Go coverage %.1f%% (CI-equivalent %.1f%%) exceeds the floor %.1f%% by >1pt -- raise FLOOR in scripts/check-go-coverage.sh\n", t, ct, f }
    else { printf "Go coverage %.1f%% (floor %.1f%%; CI-equivalent %.1f%% does not clear the raise threshold)\n", t, ct, f }
  }'
else
  awk -v t="$TOTAL" -v f="$FLOOR" 'BEGIN {
    printf "note: Go coverage %.1f%% exceeds the floor %.1f%% by >1pt -- raise FLOOR in scripts/check-go-coverage.sh\n", t, f
  }'
fi
