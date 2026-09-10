#!/usr/bin/env bash
# Runs derive.sh (and render.sh, when a dispatch ledger exists)
# against the REAL repo and asserts structural invariants on the
# result. Vitest is the wrong layer for a shell script's output (goal
# 0210 S1) -- this is deliberately its own check, not wired into CI
# yet (that promotion call belongs to the session that reviews this
# PR).
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/dashboard-selftest.XXXXXX")"
tmp_out="$tmp_dir/out.json"
tmp_html="$tmp_dir/out.html"
trap 'rm -rf "$tmp_dir"' EXIT

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

assert len(census) > 0, "census is empty -- parsed defect_class metadata found nothing"

expected_census = {}
for goal in goals:
    defect_class = goal.get("defect_class")
    if defect_class is not None:
        expected_census[defect_class] = expected_census.get(defect_class, 0) + 1
assert census == expected_census, (
    f"census differs from parsed goal metadata: {census!r} != {expected_census!r}"
)

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
import json, sys
from html.parser import HTMLParser


class DispatchRows(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_dispatch = False
        self.saw_start = False
        self.saw_end = False
        self.rows = 0

    def handle_comment(self, data):
        marker = data.strip()
        if marker.startswith("DERIVED:dispatch:START"):
            self.in_dispatch = True
            self.saw_start = True
        elif marker.startswith("DERIVED:dispatch:END"):
            self.in_dispatch = False
            self.saw_end = True

    def handle_starttag(self, tag, attrs):
        if self.in_dispatch and tag == "tr":
            self.rows += 1

data_path, html_path = sys.argv[1:3]
with open(data_path) as fh:
    data = json.load(fh)
parser = DispatchRows()
with open(html_path) as fh:
    parser.feed(fh.read())

row_count = len(data["dispatch"]["rows"])
assert parser.saw_start and parser.saw_end, (
    "DERIVED:dispatch block not found in rendered page"
)
rendered_rows = parser.rows
assert rendered_rows >= row_count, (
    f"rendered dispatch block has {rendered_rows} rows, ledger has {row_count}"
)
print(f"OK: dispatch block has {rendered_rows} rows (ledger: {row_count})")
PY
fi

# invariant 5: turns-per-goal.sh's counting logic against the committed
# synthetic fixtures (fixtures/turns/session-{a,b}.jsonl -- no real
# transcript text, see turns-per-goal.sh's own no-storage discipline)
tmp_turns="$tmp_dir/turns.json"
"$repo_root/scripts/dashboard/turns-per-goal.sh" \
  "$repo_root/scripts/dashboard/fixtures/turns" "$tmp_turns" >/dev/null

python3 - "$tmp_turns" <<'PY'
import json, sys

path = sys.argv[1]
with open(path) as fh:
    data = json.load(fh)

sessions = {s["id"]: s for s in data["sessions"]}
assert set(sessions) == {"session-a", "session-b"}, sessions.keys()

a, b = sessions["session-a"], sessions["session-b"]
assert a["toolCalls"] == 3 and a["assistantTurns"] == 2 and a["userTurns"] == 1, a
assert a["goals"] == ["0210"], a  # the fake 0000 mention has no goal file, dropped
assert b["toolCalls"] == 1 and b["assistantTurns"] == 1 and b["userTurns"] == 2, b
assert b["goals"] == ["0210"], b  # the sidechain tool_use never counts

per_goal = {r["goal"]: r for r in data["perGoal"]}
assert set(per_goal) == {"0210"}, per_goal.keys()
row = per_goal["0210"]
assert row["sessions"] == 2, row
assert row["toolCalls"] == 4, row  # 3 (session-a) + 1 (session-b)
assert row["assistantTurns"] == 3, row  # 2 + 1
assert row["userTurns"] == 3, row  # 1 + 2
assert row["status"] in ("shipped", "open"), row

print("OK: turns-per-goal fixture counts match (sessions, tool calls, "
      "turns, cross-session goal rollup, invalid-id filtering)")
PY

# invariant 6: malformed declared YAML identifies its file and leaves an
# existing dashboard artifact byte-for-byte intact.
last_good="$tmp_dir/last-good.json"
malformed_stderr="$tmp_dir/malformed.stderr"
printf '%s\n' '{"last_good":true}' >"$last_good"
if MILL_DASHBOARD_GOALS_DIR="$repo_root/internal/tools/dashboardgoals/testdata/malformed-goals" \
  "$repo_root/scripts/dashboard/derive.sh" "$last_good" >/dev/null 2>"$malformed_stderr"; then
  echo "expected malformed YAML derivation to fail" >&2
  exit 1
fi
if [[ "$(cat "$last_good")" != '{"last_good":true}' ]]; then
  echo "malformed YAML replaced the last good dashboard output" >&2
  exit 1
fi
if ! grep -q '0001-malformed.md' "$malformed_stderr"; then
  echo "malformed YAML error did not identify its source file" >&2
  cat "$malformed_stderr" >&2
  exit 1
fi
echo "OK: malformed YAML identifies its file and preserves the last good output"
