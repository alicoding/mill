#!/usr/bin/env bash
# Enforces .claude/rules/ux-writing.md's two objective leak classes.
#
# 1. Internal-document references: UI copy (locale JSON, seeded
#    workflow descriptions) must never cite docs/ paths, ADR ids,
#    goal-file ids, or section symbols, which mean nothing to a reader
#    inside the app.
# 2. Dash clauses: a sentence whose second half hangs off a dash is a
#    spec-aside justifying the design, not copy the reader can act on.
#    It also renders as a literal double hyphen in the app.
#
# Run by lefthook (pre-commit) and CI's ui-copy job -- one script both
# call, same non-drift shape as check-loc.sh.
# Voice/length rules stay review-checked (see the rule file); this
# gate covers only what a grep can assert without false authority.
set -euo pipefail

pattern='docs/(adr|goals|SPEC)|ADR-[0-9]|goal [0-9]{4}|§'

violations=0

report() {
  echo "ui-copy: $1"
  violations=$((violations + 1))
}

# Seeded entity descriptions render straight into the app the same as
# locale strings do (workflow seeds into the palette/canvas, list and
# HTTP-request seeds into Configure), so they carry the same bars.
seed_go_files() {
  git ls-files -- 'internal/*.go' |
    grep -v '_test\.go$' |
    grep -E 'internal/domain/[a-z]+/builtin.*\.go$|internal/services/seeding/|_builtin.*\.go$|seed.*\.go$|builtinworkflows.*\.go$' || true
}

# ---------------------------------------------------------------- 1 --
while IFS= read -r -d '' file; do
  hits="$(grep -nE "$pattern" "$file" || true)"
  if [[ -n "$hits" ]]; then
    while IFS= read -r hit; do report "$file:$hit"; done <<< "$hits"
  fi
done < <(git ls-files -z -- 'frontend/src/locales/*.json')

# Scoped to lines that actually declare a Description (rather than the
# whole file) so this doesn't flag the packages' own doc-citing
# comments, which are legitimate.
while IFS= read -r file; do
  hits="$(grep -nE 'Description:' "$file" | grep -E "$pattern" || true)"
  if [[ -n "$hits" ]]; then
    while IFS= read -r hit; do report "$file:$hit"; done <<< "$hits"
  fi
done < <(git ls-files -- 'internal/domain/composition/builtinworkflows*.go' 'internal/domain/list/builtin.go' 'internal/domain/httprequest/builtin.go')

# ---------------------------------------------------------------- 2 --
dash_message() {
  echo "dash clause in product copy: split the sentence or drop the aside (goal 0338, ux-writing.md)"
}

# Locale values: every line in these files is either a key or a string
# the app renders, so a whole-line match is exact enough. A clause dash
# always has whitespace in front of it; an unspaced en dash is a RANGE
# ("Name A-Z", "3-20 of 40"), which is correct typography and not an
# aside, so the pattern requires the leading space.
while IFS= read -r -d '' file; do
  hits="$(grep -nE ' -- | —| –' "$file" || true)"
  if [[ -n "$hits" ]]; then
    while IFS= read -r hit; do report "$file:$hit -- $(dash_message)"; done <<< "$hits"
  fi
done < <(git ls-files -z -- 'frontend/src/locales/*.json')

# Go seeds: only the STRING LITERALS count. The scanner below walks each
# line character by character so a dash inside a // comment (where
# provenance and design notes legitimately live) is never mistaken for
# copy the app renders.
go_literal_scanner='
{
  line = $0; out = ""; n = length(line); i = 1; state = 0
  while (i <= n) {
    c = substr(line, i, 1)
    if (state == 0) {
      if (c == "/" && substr(line, i + 1, 1) == "/") break
      else if (c == "\"") state = 1
      else if (c == "`") state = 2
      else if (c == "\x27") state = 3
    } else if (state == 1) {
      if (c == "\\") { i += 2; continue }
      if (c == "\"") state = 0; else out = out c
    } else if (state == 2) {
      if (c == "`") state = 0; else out = out c
    } else {
      if (c == "\\") { i += 2; continue }
      if (c == "\x27") state = 0
    }
    i++
  }
  if (out ~ / -- / || out ~ /—/ || out ~ /–/) printf "%s:%s: %s\n", FILENAME, FNR, out
}'
while IFS= read -r file; do
  hits="$(awk "$go_literal_scanner" "$file" || true)"
  if [[ -n "$hits" ]]; then
    while IFS= read -r hit; do report "$hit -- $(dash_message)"; done <<< "$hits"
  fi
done < <(seed_go_files)

# User docs are prose, so the typographic em dash is correct there and
# only the literal double hyphen is wrong. A dash inside a fenced block
# or an inline code span is code, not prose, and stays.
# userdocs/reference/plugin-api/** is TypeDoc output from the plugin
# SDK's own doc comments (frontend/src/plugins/sdk.ts): fix it at that
# source, not in the generated tree check-sdk-freshness.sh overwrites.
docs_prose_scanner='
FNR == 1 { fence = 0; fm = ($0 == "---") }
fm { if (FNR > 1 && $0 == "---") fm = 0; next }
/^[ \t]*(```|~~~)/ { fence = !fence; next }
fence { next }
{
  out = ""; incode = 0; n = length($0)
  for (i = 1; i <= n; i++) {
    c = substr($0, i, 1)
    if (c == "`") { incode = !incode; continue }
    if (!incode) out = out c
  }
  if (out ~ / -- /) printf "%s:%s: %s\n", FILENAME, FNR, $0
}'
while IFS= read -r -d '' file; do
  case "$file" in userdocs/reference/plugin-api/*) continue ;; esac
  hits="$(awk "$docs_prose_scanner" "$file" || true)"
  if [[ -n "$hits" ]]; then
    while IFS= read -r hit; do report "$hit -- $(dash_message)"; done <<< "$hits"
  fi
done < <(git ls-files -z -- 'userdocs/*.md')

if [[ "$violations" -gt 0 ]]; then
  echo
  echo "ui-copy: $violations violation(s). UI copy states behavior in the"
  echo "user's vocabulary -- internal doc references belong in docs/, not"
  echo "in strings the app renders, and a dash clause is a spec-aside, not"
  echo "a sentence a reader can act on. See .claude/rules/ux-writing.md."
  exit 1
fi
