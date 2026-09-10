#!/usr/bin/env bash
# Proves scripts/check-go-coverage.sh's "raise FLOOR" hint measures what
# CI measures (goal 0413 S2 rider, #880): silent when the real total
# clears a temporary FLOOR by 0.9pt, prints once it clears by 1.1pt.
# Runs against a real, tiny coverprofile (internal/tools/enghealth,
# never quarantined -- see quarantined_packages in the script under
# test) so `go tool cover -func`'s own function-boundary math does the
# measuring: a hand-fabricated profile can't fake a total past that
# tool's AST-mapped statement accounting.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/mill-coverage-hint-test.XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT

PROFILE="$WORKDIR/real.out"
go test ./internal/tools/enghealth/... -coverprofile="$PROFILE" >/dev/null

TOTAL=$(go tool cover -func="$PROFILE" | awk '/^total:/ {gsub(/%/,"",$3); print $3}')
if [ -z "$TOTAL" ]; then
  echo "check-go-coverage-hint.test: no total measured" >&2
  exit 1
fi

run_with_floor() {
  local floor="$1"
  local script="$WORKDIR/check-go-coverage.sh"
  sed "s/^FLOOR=\"75.0\"\$/FLOOR=\"${floor}\"/" scripts/check-go-coverage.sh > "$script"
  bash "$script" "$PROFILE"
}

SILENT_FLOOR=$(awk -v t="$TOTAL" 'BEGIN { printf "%.4f", t - 0.9 }')
PRINTS_FLOOR=$(awk -v t="$TOTAL" 'BEGIN { printf "%.4f", t - 1.1 }')

SILENT_OUT="$(run_with_floor "$SILENT_FLOOR")"
if echo "$SILENT_OUT" | grep -q "raise FLOOR"; then
  echo "FAIL: hint fired at FLOOR+0.9 (total ${TOTAL}%, floor ${SILENT_FLOOR}%):" >&2
  echo "$SILENT_OUT" >&2
  exit 1
fi

PRINTS_OUT="$(run_with_floor "$PRINTS_FLOOR")"
if ! echo "$PRINTS_OUT" | grep -q "raise FLOOR"; then
  echo "FAIL: hint did not fire at FLOOR+1.1 (total ${TOTAL}%, floor ${PRINTS_FLOOR}%):" >&2
  echo "$PRINTS_OUT" >&2
  exit 1
fi

echo "check-go-coverage-hint.test: ok (silent at floor+0.9, prints at floor+1.1)"
