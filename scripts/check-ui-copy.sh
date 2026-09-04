#!/usr/bin/env bash
# Enforces .claude/rules/ux-writing.md's two objective leak classes.
#
# 1. Internal-document references: UI copy (locale JSON, seeded
#    workflow descriptions) must never cite docs/ paths, ADR ids,
#    goal-file ids, or section symbols, which mean nothing to a reader
#    inside the app.
# 2. Dash clauses: a sentence whose second half hangs off a dash is a
#    spec-aside justifying the design, not copy the reader can act on.
#    It also renders as a literal double hyphen in the app. Checked in
#    the locale JSON, the Go seeds, the user docs, and (goal 0341) the
#    TypeScript string literals -- copy that never reached a locale
#    file is still copy, and a `${a} -- ${b}` join is a dash clause
#    split across two quasis.
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
# the app renders, so a whole-line match is exact enough.
while IFS= read -r -d '' file; do
  # An en dash is a clause only when spaced; unspaced between two tokens
  # it is a range ("A–Z", "1–25 of 40"), the one legitimate dash in copy.
  hits="$(grep -nE ' -- |—| – ' "$file" || true)"
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
# SDK's own doc comments (frontend/src/plugins/sdk.ts) -- gated like
# every other page since goal 0341 rewrote that source, so a new
# double hyphen in an SDK doc comment fails here and is fixed there,
# never in the generated tree check-sdk-freshness.sh overwrites.
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
  hits="$(awk "$docs_prose_scanner" "$file" || true)"
  if [[ -n "$hits" ]]; then
    while IFS= read -r hit; do report "$hit -- $(dash_message)"; done <<< "$hits"
  fi
done < <(git ls-files -z -- 'userdocs/*.md')

# TypeScript/TSX: the same literals-only discipline the Go scanner
# above applies, so a dash inside a // or /* */ comment (where design
# notes legitimately live) is never mistaken for copy. Template
# literals count: a `${a} -- ${b}` join renders the dash exactly as a
# whole-string one does. Tests and e2e specs are excluded -- they
# assert against copy rather than being it.
#
# A dash is a CLAUSE only with content on at least one side and a space
# beside it: `var(--fgColor-muted)` is a CSS custom property, "1-25 of
# 40" (en dash) is a range, and a lone em dash is an empty-cell
# placeholder. Same three carve-outs frontend/eslint.config.js's own
# no-literal-string patterns make, kept in step by hand.
ts_literal_scanner='
FNR == 1 { blockcomment = 0 }
{
  line = $0; out = ""; n = length(line); i = 1
  # String state is per line; BLOCK-comment state is not -- a JSX
  # comment ({/* ... */}) routinely spans lines, and an apostrophe in
  # its prose would otherwise read as an opening quote on the
  # continuation line.
  state = blockcomment ? 4 : 0
  while (i <= n) {
    c = substr(line, i, 1)
    if (state == 0) {
      if (c == "/" && substr(line, i + 1, 1) == "/") break
      else if (c == "/" && substr(line, i + 1, 1) == "*") { state = 4; i += 2; continue }
      else if (c == "\"") state = 1
      else if (c == "\x27") state = 3
      else if (c == "`") state = 2
    } else if (state == 4) {
      if (c == "*" && substr(line, i + 1, 1) == "/") { state = 0; i += 2; continue }
    } else if (state == 1) {
      if (c == "\\") { i += 2; continue }
      if (c == "\"") state = 0; else out = out c
    } else if (state == 2) {
      if (c == "\\") { i += 2; continue }
      if (c == "`") state = 0; else out = out c
    } else {
      if (c == "\\") { i += 2; continue }
      if (c == "\x27") state = 0; else out = out c
    }
    i++
  }
  blockcomment = (state == 4)
  if (out ~ /[^ ] (--|—|–)( |$)/ || out ~ /(^| )(--|—|–) [^ ]/) printf "%s:%s: %s\n", FILENAME, FNR, out
}'
while IFS= read -r -d '' file; do
  hits="$(awk "$ts_literal_scanner" "$file" || true)"
  if [[ -n "$hits" ]]; then
    while IFS= read -r hit; do report "$hit -- $(dash_message)"; done <<< "$hits"
  fi
done < <(git ls-files -z -- 'frontend/src/*.ts' 'frontend/src/*.tsx' |
  grep -zv '\.test\.tsx\?$' || true)

if [[ "$violations" -gt 0 ]]; then
  echo
  echo "ui-copy: $violations violation(s). UI copy states behavior in the"
  echo "user's vocabulary -- internal doc references belong in docs/, not"
  echo "in strings the app renders, and a dash clause is a spec-aside, not"
  echo "a sentence a reader can act on. See .claude/rules/ux-writing.md."
  exit 1
fi
