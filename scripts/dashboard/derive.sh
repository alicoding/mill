#!/usr/bin/env bash
# Derives dashboard-data.json from repo truth (goal on-disk state --
# no invention): docs/goals/*.md + archive/*.md frontmatter, the
# BACKLOG.md queue, a defect_class census over the same goal files, the
# DISPATCH.md live-builder ledger (goal 0210 S3), and a repo snapshot
# (main sha, open PRs). Goal metadata uses the repository's existing
# YAML library through one batch Go invocation; fixed-shape Markdown
# tables remain awk adapters. A number this script can't derive from
# the repo is simply absent from its output; render.sh never invents one.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
lib_dir="$repo_root/scripts/dashboard/lib"
goals_dir="${MILL_DASHBOARD_GOALS_DIR:-$repo_root/docs/goals}"
out="${1:-$repo_root/scripts/dashboard/dashboard-data.json}"

if [[ ! -d "$goals_dir" ]]; then
  echo "error: $goals_dir not found -- run from a checkout with docs/ present (a symlink is fine)" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
out_tmp="$(mktemp "${out}.tmp.XXXXXX")"
trap 'rm -rf "$tmp_dir"; rm -f "$out_tmp"' EXIT

# --- goals: one batch parse of every sorted Markdown path, excluding
# BACKLOG.md (the queue file, not a goal) ---
goals_file="$tmp_dir/goals.json"
(cd "$repo_root" && go run ./internal/tools/dashboardgoals "$goals_dir") >"$goals_file"

# --- queue: BACKLOG.md's own checkbox order (awk/backlog-queue.awk) ---
queue_file="$tmp_dir/queue.json"
{
  echo -n "["
  awk -f "$lib_dir/backlog-queue.awk" "$goals_dir/BACKLOG.md" | paste -sd, -
  echo -n "]"
} >"$queue_file"

# --- census: defect_class counts from the parsed goal records ---
census_file="$tmp_dir/census.json"
jq '[.[] | .defect_class | select(. != null)]
    | sort
    | group_by(.)
    | map({key: .[0], value: length})
    | from_entries' "$goals_file" >"$census_file"

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
# never-fatal shape DISPATCH.md's own absence gets above. The
# committed ledger itself carries no git-derived field any more (goal
# 0397 -- it would make two branches conflict by construction), so
# code/docs currency is merged in below from a live read of this
# checkout's own git history instead.
maturity_file="$repo_root/userdocs/reference/plugin-api-maturity.json"
if [[ -f "$maturity_file" ]]; then
  maturity_json="$(cat "$maturity_file")"
else
  maturity_json='{"generated":false}'
fi

# --- currency: each family's code/docs git dates, read live from this
# checkout (goal 0397) via the docsgen generator's own -currency entry
# point, then merged into the maturity rows above by family. A `go`
# toolchain miss or any failure here just leaves the maturity rows
# without currency fields -- never a failed derive, the same
# best-effort shape every other section above takes.
if [[ -f "$maturity_file" ]]; then
  currency_file="$tmp_dir/currency.json"
  if (cd "$repo_root/internal/docsgen" && go run ./gen -currency) >"$currency_file" 2>/dev/null; then
    maturity_json="$(python3 - "$maturity_file" "$currency_file" <<'PY'
import json, sys

maturity_path, currency_path = sys.argv[1:3]
with open(maturity_path) as fh:
    maturity = json.load(fh)
with open(currency_path) as fh:
    currency_by_family = {row["family"]: row for row in json.load(fh)}

for row in maturity.get("rows", []):
    currency = currency_by_family.get(row["family"])
    if not currency:
        continue
    for key in ("codeCommit", "codeChangedAt", "docsCommit", "docsChangedAt"):
        if key in currency:
            row[key] = currency[key]

print(json.dumps(maturity))
PY
)"
  fi
fi

# --- engineering health: the weekly report's own JSON (goal 0413 S1),
# read from the repo root when a run of engineering-health.yml has left
# one there (a real run, or the orchestrator's own `go run
# ./internal/tools/enghealth` dry run) -- absent on a fresh clone or a
# checkout that predates this goal, same best-effort "not generated yet"
# shape the maturity ledger above already takes. No new dashboard view:
# the Health/Efficiency views read this field directly.
enghealth_file="$repo_root/engineering-health.json"
if [[ -f "$enghealth_file" ]]; then
  enghealth_json="$(cat "$enghealth_file")"
else
  enghealth_json='{"generated":false}'
fi

# --- repo: current main sha + open PRs (gh optional, never fatal) ---
main_sha="$(git -C "$repo_root" rev-parse origin/main 2>/dev/null || git -C "$repo_root" rev-parse HEAD)"  # git-isolation:allow -- reads the real checkout's own sha, not a fixture
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
if "$repo_root/scripts/dashboard/turns-per-goal.sh" "" "$turns_file" "$goals_file" >/dev/null 2>&1; then
  turns_json="$(cat "$turns_file")"
else
  turns_json='{"sessions":[],"perGoal":[]}'
fi

generated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- assemble beside the destination, then rename only after every
# section succeeded so a failed refresh cannot replace the last good file ---
{
  printf '{\n'
  printf '  "generated_at": "%s",\n' "$generated_at"
  printf '  "goals": %s,\n' "$(cat "$goals_file")"
  printf '  "queue": %s,\n' "$(cat "$queue_file")"
  printf '  "census": %s,\n' "$(cat "$census_file")"
  printf '  "dispatch": %s,\n' "$dispatch_json"
  printf '  "maturity": %s,\n' "$maturity_json"
  printf '  "engineering_health": %s,\n' "$enghealth_json"
  printf '  "efficiency": {"turnsPerGoal": %s},\n' "$turns_json"
  printf '  "repo": {"main_sha": "%s", "open_prs": %s, "gh_unavailable": %s}\n' \
    "$main_sha" "$prs_json" "$gh_unavailable"
  printf '}\n'
} >"$out_tmp"
mv "$out_tmp" "$out"

echo "$out"
