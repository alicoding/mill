#!/usr/bin/env bash
# Counts turns/tool-calls per session and rolls them up per goal, from the
# owner's own local Claude Code transcripts (goal 0325 S2). READ-ONLY over
# those files: no line here ever writes to them, copies a message's text
# into the output, or prints one -- only counts and, from assistant text,
# the small set of already-existing goal ids a session mentions survive
# past the loop that finds them.
set -euo pipefail

dashboard_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$dashboard_dir/../.." && pwd)"
lib_dir="$dashboard_dir/lib"
goals_dir="$repo_root/docs/goals"

transcripts_dir="${1:-$HOME/.claude/projects/-Users-ali-code-mill}"
out="${2:-$dashboard_dir/turns-per-goal.json}"

if [[ ! -d "$goals_dir" ]]; then
  echo "error: $goals_dir not found -- run from a checkout with docs/ present (a symlink is fine)" >&2
  exit 1
fi
if [[ ! -d "$transcripts_dir" ]]; then
  echo "error: $transcripts_dir not found" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

# --- goal file objects (same awk/goal-frontmatter.awk derive.sh uses --
# id/status/prs come from frontmatter, never re-parsed by hand here).
# Filenames outside the NNNN-slug shape (BACKLOG.md, DISPATCH.md, the
# dated session notes) fall out on their own: their fallback_id doesn't
# match \b0[0-9]{3}\b, so the python pass below never treats them as a
# mentionable goal.
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
  done < <(find "$goals_dir" -name "*.md" ! -name "BACKLOG.md" | sort)
  echo -n "]"
} >"$goals_file"

python3 - "$goals_file" "$transcripts_dir" "$out" <<'PY'
import glob
import json
import os
import re
import sys

goals_path, transcripts_dir, out_path = sys.argv[1:4]

GOAL_ID_RE = re.compile(r"\b0[0-9]{3}\b")

with open(goals_path) as fh:
    goal_objs = json.load(fh)

# Only ids shaped like a real goal filename (docs/goals/NNNN-*.md or
# archive/NNNN-*.md) are mentionable -- BACKLOG.md/DISPATCH.md/session
# notes never got a matching frontmatter id or fallback, so they are
# absent from this map by construction.
goal_by_id = {}
for g in goal_objs:
    gid = g.get("id") or ""
    if not re.fullmatch(r"0[0-9]{3}", gid):
        continue
    status = (g.get("status") or "").lower()
    bucket = "shipped" if status in ("shipped", "superseded") else "open"
    if not status:
        bucket = "shipped" if g.get("archived") else "open"
    goal_by_id[gid] = {"status": bucket, "prs": g.get("prs") or []}

sessions = []
per_goal_acc = {}  # gid -> {sessions, toolCalls, assistantTurns, userTurns}

for path in sorted(glob.glob(os.path.join(transcripts_dir, "*.jsonl"))):
    session_id = os.path.splitext(os.path.basename(path))[0]
    tool_calls = 0
    assistant_turns = 0
    user_turns = 0
    mentioned = set()

    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue

            entry_type = obj.get("type")
            if obj.get("isSidechain") is True:
                continue  # a forked subagent's own turns aren't this session's

            if entry_type == "assistant":
                assistant_turns += 1
                content = obj.get("message", {}).get("content")
                if isinstance(content, list):
                    for item in content:
                        item_type = item.get("type")
                        if item_type == "tool_use":
                            tool_calls += 1
                        elif item_type == "text":
                            mentioned.update(GOAL_ID_RE.findall(item.get("text") or ""))
                        elif item_type == "thinking":
                            mentioned.update(GOAL_ID_RE.findall(item.get("thinking") or ""))
            elif entry_type == "user":
                if obj.get("isMeta") is True:
                    continue  # synthetic caveats/system notifications, not a human turn
                content = obj.get("message", {}).get("content")
                if isinstance(content, list):
                    item_types = {item.get("type") for item in content}
                    if "tool_result" in item_types:
                        continue  # the harness's own reply, not something the human typed
                user_turns += 1

    goals_here = sorted(g for g in mentioned if g in goal_by_id)
    sessions.append({
        "id": session_id,
        "toolCalls": tool_calls,
        "assistantTurns": assistant_turns,
        "userTurns": user_turns,
        "goals": goals_here,
    })

    # A session mentioning three goals counts toward all three --
    # sessions are a bounded chat, not a clean per-goal partition.
    for gid in goals_here:
        acc = per_goal_acc.setdefault(gid, {
            "sessions": 0, "toolCalls": 0, "assistantTurns": 0, "userTurns": 0,
        })
        acc["sessions"] += 1
        acc["toolCalls"] += tool_calls
        acc["assistantTurns"] += assistant_turns
        acc["userTurns"] += user_turns

per_goal = []
for gid, acc in per_goal_acc.items():
    info = goal_by_id[gid]
    per_goal.append({
        "goal": gid,
        "status": info["status"],
        "prs": info["prs"],
        "sessions": acc["sessions"],
        "toolCalls": acc["toolCalls"],
        "assistantTurns": acc["assistantTurns"],
        "userTurns": acc["userTurns"],
    })
per_goal.sort(key=lambda r: r["toolCalls"], reverse=True)

with open(out_path, "w") as fh:
    json.dump({"sessions": sessions, "perGoal": per_goal}, fh, indent=2)
    fh.write("\n")
PY

echo "$out"
