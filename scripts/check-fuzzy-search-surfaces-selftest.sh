#!/usr/bin/env bash
# Probes semgrep/fuzzy-search-surfaces.yml (goal 0366) against
# throwaway fixture trees, so an edit to the rule cannot silently stop
# catching a new picker-shaped surface skipping the shared fuzzysort
# helper, start flagging a surface that already uses it, or widen past
# its deliberate filename scope onto an exact-list search box. Two
# committed reference copies live flat under
# semgrep/fixtures/fuzzy-search-surfaces/ (outside frontend/src/**, so
# the repo's own semgrep gate never scans them directly); this script
# copies each into a throwaway tree under the filename shape the rule
# actually cares about, matching check-vendor-names-selftest.sh's own
# per-fixture-tree-root probe shape.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
config="$repo_root/semgrep/fuzzy-search-surfaces.yml"
fixtures="$repo_root/semgrep/fixtures/fuzzy-search-surfaces"
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
mkdir -p "$bad_root/frontend/src/composition"
cp "$fixtures/bad.tsx" "$bad_root/frontend/src/composition/FixtureNodePicker.tsx"
probe block "a *Picker*.tsx substring filter with no fuzzysort" "$bad_root"

good_root="$(mktemp -d)"
mkdir -p "$good_root/frontend/src/composition" "$good_root/frontend/src/shared"
cp "$fixtures/good.tsx" "$good_root/frontend/src/composition/FixtureNodePicker.tsx"
# fuzzyFilter.ts itself is never scanned here (the rule only fires on
# *Palette*/*Picker*/*Browse* filenames) -- present only so the good
# fixture's own relative import resolves for a human reading the tree.
cp "$repo_root/frontend/src/shared/fuzzyFilter.ts" "$good_root/frontend/src/shared/fuzzyFilter.ts"
probe clean "a *Picker*.tsx filtering through the shared fuzzysort helper" "$good_root"

exempt_root="$(mktemp -d)"
mkdir -p "$exempt_root/frontend/src/views"
# Same substring-filter body as the bad fixture, but under a filename
# outside the glob -- an exact-list search box (goal 0366 inventory
# #13's 13 sites) stays a plain substring match by design.
cp "$fixtures/bad.tsx" "$exempt_root/frontend/src/views/KeyboardShortcutsSection.tsx"
probe clean "an exact-list surface's substring filter stays outside the glob" "$exempt_root"

rm -rf "$bad_root" "$good_root" "$exempt_root"

if [ "$fails" -ne 0 ]; then
  echo "check-fuzzy-search-surfaces-selftest: $fails probe(s) failed" >&2
  exit 1
fi
echo "check-fuzzy-search-surfaces-selftest: OK"
