#!/usr/bin/env bash
# Runs derive.sh (and render.sh, when a dispatch ledger exists)
# against the REAL repo and asserts structural invariants on the
# result. Vitest is the wrong layer for a shell script's output (goal
# 0210 S1) -- this is deliberately its own check, not wired into CI
# yet (that promotion call belongs to the session that reviews this
# PR).
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp_out="$(mktemp -t dashboard-selftest-XXXXXX.json)"
tmp_html="$(mktemp -t dashboard-selftest-XXXXXX.html)"
trap 'rm -f "$tmp_out" "$tmp_html"' EXIT

"$repo_root/scripts/dashboard/derive.sh" "$tmp_out" >/dev/null

python3 - "$tmp_out" <<'PY'
import json, sys

path = sys.argv[1]
with open(path) as fh:
    data = json.load(fh)  # invariant 1: the output parses as JSON

goals = data["goals"]
queue = data["queue"]
census = data["census"]

assert len(goals) >= 40, f"expected >=40 goals, found {len(goals)}"

assert len(census) > 0, "census is empty -- defect_class grep found nothing"

goal_ids = {g["id"] for g in goals}
unresolved = [q for q in queue if q["id"] and q["id"] not in goal_ids]
assert not unresolved, (
    "BACKLOG entries whose id has no matching goal file: "
    + ", ".join(q["id"] for q in unresolved)
)

print(f"OK: {len(goals)} goals, {len(queue)} queue lines, "
      f"{len(census)} defect classes, 0 unresolved BACKLOG ids")
PY

# invariant 4: when the dispatch ledger exists, the rendered page's
# DERIVED:dispatch block carries at least as many rows as the ledger
if [[ -f "$repo_root/docs/goals/DISPATCH.md" ]]; then
  "$repo_root/scripts/dashboard/render.sh" "$tmp_out" "$tmp_html" >/dev/null
  python3 - "$tmp_out" "$tmp_html" <<'PY'
import json, re, sys

data_path, html_path = sys.argv[1:3]
with open(data_path) as fh:
    data = json.load(fh)
with open(html_path) as fh:
    html = fh.read()

row_count = len(data["dispatch"]["rows"])
m = re.search(
    r"<!-- DERIVED:dispatch:START.*?-->(.*?)<!-- DERIVED:dispatch:END -->",
    html, re.DOTALL,
)
assert m, "DERIVED:dispatch block not found in rendered page"
rendered_rows = len(re.findall(r"<tr><td>", m.group(1)))
assert rendered_rows >= row_count, (
    f"rendered dispatch block has {rendered_rows} rows, ledger has {row_count}"
)
print(f"OK: dispatch block has {rendered_rows} rows (ledger: {row_count})")
PY
fi
