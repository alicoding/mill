#!/usr/bin/env bash
# Enforces CLAUDE.md's 500-line-per-file convention across every Go/TS/TSX
# file Mill actually owns. Run by lefthook (pre-commit) and CI's
# file-loc-limit job -- lefthook.yml's own header says it mirrors CI, so
# this lives as one script both call, not two copies that can drift.
set -euo pipefail
cd "$(dirname "$0")/.."

# Limit and exclude set live in scripts/loc-policy.json -- the single
# source goal 0413's enghealth "files near the LOC cap" metric reads
# too, so the two never drift against each other by hand-edit.
limit=$(jq -r '.limit' scripts/loc-policy.json)
exclude_regex=$(jq -r '.exclude_regex' scripts/loc-policy.json)

violations=0
while IFS= read -r -d '' file; do
  case "$file" in
    *.go | *.ts | *.tsx) ;;
    *) continue ;;
  esac
  if [[ "$file" =~ $exclude_regex ]]; then
    continue
  fi
  if [[ ! -f "$file" ]]; then
    continue
  fi
  lines=$(wc -l <"$file")
  if ((lines > limit)); then
    echo "  $file: $lines lines (limit $limit)"
    violations=$((violations + 1))
  fi
done < <(git ls-files -z)

if ((violations > 0)); then
  echo "error: $violations file(s) exceed the ${limit}-line convention (CLAUDE.md) -- split along a real seam, don't truncate arbitrarily." >&2
  exit 1
fi
