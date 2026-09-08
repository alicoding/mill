#!/usr/bin/env bash
# Probes semgrep/no-raf-retry-loop.yml (goal 0366) against throwaway
# fixture trees, so an edit to the rule cannot silently stop catching a
# new rAF-retry-vs-library-readiness instance, or start flagging a
# converged one-shot rAF call. Committed reference copies of both
# shapes live flat under semgrep/fixtures/no-raf-retry-loop/ (outside
# frontend/src/**, so the repo's own semgrep gate never scans them
# directly); this script copies each into a throwaway
# frontend/src/shared/ tree and scans THAT root, matching
# check-vendor-names-selftest.sh's own per-fixture-tree-root probe
# shape.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
config="$repo_root/semgrep/no-raf-retry-loop.yml"
fixtures="$repo_root/semgrep/fixtures/no-raf-retry-loop"
fails=0

# probe <expected: block|clean> <label> <root>
probe() {
  local want="$1" label="$2" root="$3" out rc
  set +e
  out="$(cd "$root" && semgrep --config "$config" --error --quiet . 2>&1)"
  rc=$?
  set -e
  if [ "$want" = "block" ] && [ "$rc" -eq 0 ]; then
    echo "FAIL: expected a blocking finding, got none: $label" >&2
    echo "$out" >&2
    fails=$((fails + 1))
  elif [ "$want" = "clean" ] && [ "$rc" -ne 0 ]; then
    echo "FAIL: expected zero findings, got a blocking finding: $label" >&2
    echo "$out" >&2
    fails=$((fails + 1))
  fi
}

bad_root="$(mktemp -d)"
mkdir -p "$bad_root/frontend/src/shared"
cp "$fixtures/bad.tsx" "$bad_root/frontend/src/shared/FixtureRafRetry.tsx"
probe block "a bounded rAF retry loop (pre-0390 openRename shape)" "$bad_root"

good_root="$(mktemp -d)"
mkdir -p "$good_root/frontend/src/shared"
cp "$fixtures/good.tsx" "$good_root/frontend/src/shared/FixtureRafPaint.tsx"
probe clean "a single one-shot rAF for the next paint" "$good_root"

rm -rf "$bad_root" "$good_root"

if [ "$fails" -ne 0 ]; then
  echo "check-no-raf-retry-loop-selftest: $fails probe(s) failed" >&2
  exit 1
fi
echo "check-no-raf-retry-loop-selftest: OK"
