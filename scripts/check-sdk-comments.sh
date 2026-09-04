#!/usr/bin/env bash
# The plugin standard's rule 18: the generated SDK types and their
# published reference describe behaviour for a plugin AUTHOR, who has
# no access to this repository -- a goal id, an ADR reference, a
# docs/ path, or an internal file name (hostApi.ts, a .go or .tsx
# file) means nothing to them and leaks repository internals. Checked
# over the GENERATED outputs, not frontend/src/plugins/sdk.ts itself,
# so it catches anything that leaked through regardless of which
# source file it came from. Run by lefthook (pre-commit) and CI's
# sdk-comments job.
set -euo pipefail

cd "$(dirname "$0")/.."

phrases='goal 0|goals/|docs/|\.tsx|\.go\b|hostApi|ADR-'

violations=0
while IFS= read -r -d '' file; do
  hits="$(grep -inE "$phrases" "$file" || true)"
  if [[ -n "$hits" ]]; then
    while IFS= read -r hit; do
      echo "sdk-comments: $file:$hit"
      violations=$((violations + 1))
    done <<< "$hits"
  fi
done < <(find userdocs/reference/plugin-api frontend/plugin-sdk/index.d.ts -type f -print0 2>/dev/null)

if [[ "$violations" -gt 0 ]]; then
  echo >&2
  echo "error: the generated plugin SDK reference carries repository vocabulary a plugin author cannot use (standard rule 18)." >&2
  echo "Rewrite the doc comment in frontend/src/plugins/sdk/*.ts, then run 'npm run sdk:build && npm run docs:sdk' in frontend/." >&2
  exit 1
fi
