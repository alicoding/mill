#!/usr/bin/env bash
# Keeps e2e count assertions honest about WHERE their number comes
# from (goal 0358 S7).
#
# The class this exists for: a spec asserting the size of a set the
# app OWNS -- every registered step type, every built-in Extensions
# row, every seeded object filed in one place -- written as a literal.
# It goes stale the moment an unrelated feature adds one member, and
# the red lands on that feature's PR rather than on anything it broke.
# The number was never the property under test; completeness was.
#
# The fix is to read the set back through the same door the surface is
# built from (frontend/e2e/fixtures/registryCounts.ts), so the
# assertion says "renders every member" and survives the set growing.
#
# What this gate flags: a numeric literal of 2 or more inside
# toHaveCount(...)/toHaveText('N'), or an "N items inside" sentence, on
# a line that ALSO names a registry- or seed-derived locator. The
# locator list is deliberately short and specific -- a broad heuristic
# here would flag the hundreds of legitimate literals counting entities
# a test created itself, and a gate that cries wolf gets suppressed.
#
# Escape hatch, same line as the assertion:
#   count: fixture-owned  -- entities this test created; nothing else grows them.
#   count: seed-shape     -- one named seed's own shape; a new seed does not move it.
#   count: seed-owned     -- a set that DOES grow, with no door to read it back.
#                            Must name what owns it and where the fix is tracked.
# Never use one to silence a count a door could have supplied.
#
# Run by lefthook (pre-commit) and CI's e2e-seed-literals job -- one
# script both call, the same non-drift shape as check-comment-hygiene.sh.
set -euo pipefail

# Locators whose count is owned by a registry or the seed set, not by
# the test. Keep this list precise; add a name only with a real case.
locators='palette-item|palette-group|extensions-row|extensions-plugin-row|list-count|items inside|builtInRows|inventory-row'

# A literal of 2+ in a count assertion, or an "N items inside" sentence.
literals="toHaveCount\\([2-9][0-9]*\\)|toHaveText\\('[2-9][0-9]*'\\)|[2-9][0-9]* items inside"

allow='count: (fixture-owned|seed-shape|seed-owned)'

violations=0

while IFS= read -r -d '' file; do
  hits="$(grep -nE "$literals" "$file" | grep -E "$locators" | grep -vE "$allow" || true)"
  if [[ -n "$hits" ]]; then
    while IFS= read -r hit; do
      echo "e2e-seed-literals: $file:$hit"
      violations=$((violations + 1))
    done <<< "$hits"
  fi
done < <(git ls-files -z -- 'frontend/e2e/**/*.ts' 'frontend/e2e/*.ts')

if (( violations > 0 )); then
  cat >&2 <<'MSG'

A count above names a set the app owns, written as a literal.

Read the set back through the door the surface is built from --
frontend/e2e/fixtures/registryCounts.ts has the registry door
(registeredStepTypes), and a harness that installs a fixed set should
return what it installed (fixtures/runtimePlugins.ts's installedIds).

If the count really is the test's own fixture, or one seed's own shape,
say so on the same line:
  // count: fixture-owned -- <what this test created>
  // count: seed-shape    -- <the one seed whose shape this is>
  // count: seed-owned    -- <what owns it, and where the fix is tracked>
MSG
  exit 1
fi

echo "e2e-seed-literals: 0 violation(s)."
