#!/usr/bin/env bash
# Derives dashboard-data.json from repo truth (goal on-disk state --
# no invention): docs/goals/*.md + archive/*.md frontmatter, the
# BACKLOG.md queue, a defect_class census over the same goal files, and
# a repo snapshot (main sha, open PRs). Plain awk/sed parsing -- no new
# dependency (goal 0210 S1). A number this script can't derive from the
# repo is simply absent from its output; render.sh never invents one.
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

generated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- assemble: every piece above is already valid JSON text, so the
# final document is plain concatenation -- no JSON library needed ---
{
  printf '{\n'
  printf '  "generated_at": "%s",\n' "$generated_at"
  printf '  "goals": %s,\n' "$(cat "$goals_file")"
  printf '  "queue": %s,\n' "$(cat "$queue_file")"
  printf '  "census": %s,\n' "$(cat "$census_file")"
  printf '  "repo": {"main_sha": "%s", "open_prs": %s, "gh_unavailable": %s}\n' \
    "$main_sha" "$prs_json" "$gh_unavailable"
  printf '}\n'
} >"$out"

echo "$out"
