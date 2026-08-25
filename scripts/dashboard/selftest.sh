#!/usr/bin/env bash
# Runs derive.sh against the REAL repo and asserts structural
# invariants on the result. Vitest is the wrong layer for a shell
# script's output (goal 0210 S1) -- this is deliberately its own
# check, not wired into CI yet (that promotion call belongs to the
# session that reviews this PR).
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp_out="$(mktemp -t dashboard-selftest-XXXXXX.json)"
trap 'rm -f "$tmp_out"' EXIT

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
