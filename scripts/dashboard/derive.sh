#!/usr/bin/env bash
# Derives dashboard-data.json from repo truth (goal on-disk state --
# no invention): docs/goals/*.md + archive/*.md frontmatter, the
# BACKLOG.md queue, a defect_class census over the same goal files, the
# DISPATCH.md live-builder ledger (goal 0210 S3), and a repo snapshot
# (main sha, open PRs). Plain awk/sed parsing -- no new dependency
# (goal 0210 S1). A number this script can't derive from the repo is
# simply absent from its output; render.sh never invents one.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
lib_dir="$repo_root/scripts/dashboard/lib"
goals_dir="$repo_root/docs/goals"
out="${1:-$repo_root/scripts/dashboard/dashboard-data.json}"

if [[ ! -d "$goals_dir" ]]; then
  echo "error: $goals_dir not found -- run from a checkout with docs/ present (a symlink is fine)" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

# --- goal file list: every docs/goals/*.md + archive/*.md, minus
# BACKLOG.md itself (the queue file, not a goal) ---
goal_files_list="$tmp_dir/goal-files.txt"
find "$goals_dir" -name "*.md" ! -name "BACKLOG.md" | sort >"$goal_files_list"

# --- goals: one JSON object per file (awk/goal-frontmatter.awk) ---
goals_file="$tmp_dir/goals.json"
{
  echo -n "["
  first=1
  while IFS= read -r f; do
    rel="${f#"$repo_root"/docs/goals/}"
    base="$(basename "$f")"
    fallback_id="${base%%-*}"
    archived=0
    [[ "$rel" == archive/* ]] && archived=1
    obj="$(awk -v path="$rel" -v archived="$archived" -v fallback_id="$fallback_id" \
      -f "$lib_dir/goal-frontmatter.awk" "$f")"
    if [[ $first -eq 0 ]]; then echo -n ","; fi
    first=0
    echo -n "$obj"
  done <"$goal_files_list"
  echo -n "]"
} >"$goals_file"

# --- queue: BACKLOG.md's own checkbox order (awk/backlog-queue.awk) ---
queue_file="$tmp_dir/queue.json"
{
  echo -n "["
  awk -f "$lib_dir/backlog-queue.awk" "$goals_dir/BACKLOG.md" | paste -sd, -
  echo -n "]"
} >"$queue_file"

# --- census: defect_class counts across the same goal file list ---
census_file="$tmp_dir/census.json"
{
  echo -n "{"
  xargs grep -h '^defect_class:' <"$goal_files_list" 2>/dev/null |
    sed -E 's/^defect_class: *//' |
    sort |
    uniq -c |
    sort -rn |
    awk 'BEGIN { first = 1 } {
      count = $1
      $1 = ""
      sub(/^ /, "")
      gsub(/"/, "\\\"")
      if (!first) printf ","
      first = 0
      printf "\"%s\":%s", $0, count
    }'
  echo -n "}"
} >"$census_file"

# --- dispatch: docs/goals/DISPATCH.md's live-builder table + its
# "Queued next" line (goal 0210 S3). The file may be absent -- older
# checkouts and a public clone before this goal's filing both lack it
# -- so absence degrades to an empty dispatch, never an error.
dispatch_file="$goals_dir/DISPATCH.md"
if [[ -f "$dispatch_file" ]]; then
  dispatch_json="$(awk -f "$lib_dir/dispatch-ledger.awk" "$dispatch_file")"
else
  dispatch_json='{"rows":[],"queued":""}'
fi

# --- maturity: the plugin API maturity ledger (goal 0348), generated
# by `go generate ./internal/docsgen` into userdocs/reference/. Not
# present before the first generate (or in a checkout that predates
# this goal) -- degrades to a "not generated yet" marker, the same
# never-fatal shape DISPATCH.md's own absence gets above.
maturity_file="$repo_root/userdocs/reference/plugin-api-maturity.json"
if [[ -f "$maturity_file" ]]; then
  maturity_json="$(cat "$maturity_file")"
else
  maturity_json='{"generated":false}'
fi

# --- repo: current main sha + open PRs (gh optional, never fatal) ---
main_sha="$(git -C "$repo_root" rev-parse origin/main 2>/dev/null || git -C "$repo_root" rev-parse HEAD)"
prs_json="[]"
gh_unavailable="true"
if command -v gh >/dev/null 2>&1; then
  if pr_out="$(cd "$repo_root" && gh pr list --json number,title,state --limit 50 2>/dev/null)"; then
    prs_json="$pr_out"
    gh_unavailable="false"
  fi
fi

# --- efficiency: turns/tool-calls per session, rolled up per goal, from
# the owner's own local Claude Code transcripts (goal 0325 S2,
# turns-per-goal.sh). Best-effort -- a machine with no local transcript
# history (a fresh clone, CI) degrades to an empty series rather than
# failing the whole derive.
turns_file="$tmp_dir/turns-per-goal.json"
if "$repo_root/scripts/dashboard/turns-per-goal.sh" "" "$turns_file" >/dev/null 2>&1; then
  turns_json="$(cat "$turns_file")"
else
  turns_json='{"sessions":[],"perGoal":[]}'
fi

generated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- assemble: every piece above is already valid JSON text, so the
# final document is plain concatenation -- no JSON library needed ---
{
  printf '{\n'
  printf '  "generated_at": "%s",\n' "$generated_at"
  printf '  "goals": %s,\n' "$(cat "$goals_file")"
  printf '  "queue": %s,\n' "$(cat "$queue_file")"
  printf '  "census": %s,\n' "$(cat "$census_file")"
  printf '  "dispatch": %s,\n' "$dispatch_json"
  printf '  "maturity": %s,\n' "$maturity_json"
  printf '  "efficiency": {"turnsPerGoal": %s},\n' "$turns_json"
  printf '  "repo": {"main_sha": "%s", "open_prs": %s, "gh_unavailable": %s}\n' \
    "$main_sha" "$prs_json" "$gh_unavailable"
  printf '}\n'
} >"$out"

echo "$out"
