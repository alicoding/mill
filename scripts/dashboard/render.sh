#!/usr/bin/env bash
# Renders mill-control-room.html from template.html + dashboard-data.json.
# Substitution runs through a small python3 inline block (goal 0210 S1) --
# regex-only sed-through-HTML was tried first and rejected: the census/
# ledger rows need real looping and number formatting, which turns into
# an unreadable sed pipeline fast. Every DERIVED:<name>:START/:END comment
# pair in template.html is a substitution region; content between the
# markers is replaced, the markers themselves stay so re-render is
# idempotent. Everything outside a marked region is copied through
# byte-for-byte (the AUTHORED sections: mermaid diagrams, capability map,
# contract legend, coupling matrix, extension tiers, roadmap swimlane).
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
dashboard_dir="$repo_root/scripts/dashboard"
data_file="${1:-$dashboard_dir/dashboard-data.json}"
out="${2:-$dashboard_dir/mill-control-room.html}"

if [[ ! -f "$data_file" ]]; then
  echo "error: $data_file not found -- run derive.sh first" >&2
  exit 1
fi

python3 - "$dashboard_dir/template.html" "$data_file" "$out" <<'PY'
import json, re, sys

template_path, data_path, out_path = sys.argv[1:4]

with open(template_path) as fh:
    html = fh.read()
with open(data_path) as fh:
    data = json.load(fh)

goals = data["goals"]
queue = data["queue"]
census = data["census"]
dispatch = data.get("dispatch") or {"rows": [], "queued": ""}
repo = data["repo"]


def substitute(name, body):
    global html
    pattern = re.compile(
        r"(<!-- DERIVED:%s:START.*?-->)(.*?)(<!-- DERIVED:%s:END -->)" % (name, name),
        re.DOTALL,
    )
    html, n = pattern.subn(lambda m: m.group(1) + body + m.group(3), html, count=1)
    if n != 1:
        raise SystemExit(f"error: DERIVED:{name} marker pair not found in template")


def esc(s):
    if s is None:
        return ""
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def strip_id_prefix(title, goal_id):
    if not title:
        return ""
    t = re.sub(r"^(Goal )?%s( —| -)\s*" % re.escape(goal_id), "", title)
    return t


# --- stamp ---
sha_short = repo["main_sha"][:7]
stamp = (
    '\n  <div class="stamp">checkpoint %s &middot; main <b>%s</b> &middot; '
    "derivation script = 0210 S1</div>\n  " % (esc(data["generated_at"]), esc(sha_short))
)
substitute("stamp", stamp)

# --- stat tiles ---
shipped_count = sum(1 for g in goals if g.get("status") == "shipped")
in_progress_count = sum(1 for q in queue if q["checked"] == "~")
queued_count = sum(1 for q in queue if q["checked"] == " " and q["id"])
open_pr_count = "—" if repo["gh_unavailable"] else str(len(repo["open_prs"]))
tiles = """
<div class="tiles">
  <div class="tile"><b>%s</b><span>goals shipped</span></div>
  <div class="tile"><b>%s</b><span>in progress</span></div>
  <div class="tile"><b>%s</b><span>queued next</span></div>
  <div class="tile"><b>%s</b><span>open PRs</span></div>
</div>
""" % (shipped_count, in_progress_count, queued_count, open_pr_count)
substitute("stat-tiles", tiles)

# --- dispatch (docs/goals/DISPATCH.md: live builders/PRs; state chips
# are simple substring rules -- "starved"/"failed"/"red" outrank "CI"
# since a CI-starved PR is worse than a merely-in-CI one) ---
def dispatch_chip_class(state):
    s = (state or "").lower()
    if "starved" in s or "failed" in s or "red" in s:
        return "crit"
    if "ci" in s:
        return "warn"
    return "plain"


dispatch_rows = dispatch.get("rows") or []
if dispatch_rows:
    rows = []
    for r in dispatch_rows:
        chip_cls = dispatch_chip_class(r.get("state"))
        pr = r.get("pr") or ""
        pr_cell = esc(pr) if pr else "&mdash;"
        rows.append(
            '    <tr><td>%s</td><td>%s</td><td><span class="chip %s">%s</span></td>'
            '<td class="mono">%s</td><td class="num">%s</td></tr>'
            % (esc(r.get("goal")), esc(r.get("what")), chip_cls, esc(r.get("state")),
               esc(r.get("touch_set")), pr_cell)
        )
    rows_html = "\n".join(rows)
else:
    rows_html = '    <tr><td colspan="5">Nothing currently being built.</td></tr>'
queued = dispatch.get("queued") or ""
queued_note = "Queued next: %s" % esc(queued) if queued else "Nothing queued next."
dispatch_html = (
    '\n  <div class="card"><table>\n'
    "    <tr><th>goal</th><th>what</th><th>state</th><th>touch-set</th><th>PR</th></tr>\n"
    "%s\n  </table></div>\n"
    '  <div class="note">%s</div>\n  ' % (rows_html, queued_note)
)
substitute("dispatch", dispatch_html)

# --- in-flight (queue rows checked "~") ---
in_flight = [q for q in queue if q["checked"] == "~"]
if in_flight:
    rows = "\n".join(
        '    <tr><td>%s</td><td><span class="chip warn">in progress</span></td><td>%s</td></tr>'
        % (
            esc(strip_id_prefix(q["title"], q["id"]) if q["title"] else q["label"]),
            esc(q["status_phrase"]) or "&mdash;",
        )
        for q in in_flight
    )
else:
    rows = '    <tr><td colspan="3">Nothing currently marked in progress.</td></tr>'
in_flight_html = (
    '\n  <div class="card"><table>\n'
    "    <tr><th>work</th><th>state</th><th>what's known</th></tr>\n"
    "%s\n  </table></div>\n  " % rows
)
substitute("in-flight", in_flight_html)

# --- shipped ledger (most recent goals.status==shipped, by date) ---
shipped = [g for g in goals if g.get("status") == "shipped"]
shipped.sort(key=lambda g: g.get("date") or "", reverse=True)
shipped = shipped[:15]
if shipped:
    rows = []
    for g in shipped:
        prs = g.get("prs") or []
        pr_text = " ".join("#%s" % p for p in prs) if prs else "&mdash;"
        title = strip_id_prefix(g["title"], g["id"])
        rows.append(
            '    <tr><td>%s</td><td class="num">%s</td><td>%s</td></tr>'
            % (esc(g["id"]), pr_text, esc(title))
        )
    rows_html = "\n".join(rows)
else:
    rows_html = '    <tr><td colspan="3">No shipped goals found.</td></tr>'
ledger_html = (
    '\n  <div class="card"><table>\n'
    "    <tr><th>goal</th><th>PR</th><th>title</th></tr>\n"
    "%s\n  </table></div>\n  " % rows_html
)
substitute("shipped-ledger", ledger_html)

# --- defect-class census ---
if census:
    max_count = max(census.values())
    rows = []
    for cls, count in census.items():
        width = max(8, round(90 * count / max_count))
        rows.append(
            '    <tr><td>%s</td><td class="num"><span class="bar" style="width:%dpx"></span>%s</td></tr>'
            % (esc(cls), width, count)
        )
    rows_html = "\n".join(rows)
else:
    rows_html = '    <tr><td colspan="2">No defect_class entries found in any goal file.</td></tr>'
census_html = (
    '\n  <div class="card"><table>\n'
    "    <tr><th>class</th><th>strikes</th></tr>\n"
    "%s\n  </table></div>\n"
    '  <div class="note">Class-level fix status isn\'t derived yet '
    "&mdash; each class's own goal file has the remediation record.</div>\n  "
    % rows_html
)
substitute("census", census_html)

with open(out_path, "w") as fh:
    fh.write(html)
PY

echo "$out"
