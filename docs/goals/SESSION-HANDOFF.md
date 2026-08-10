# Session handoff — 2026-08-09 → 08-10 overnight

Read this first in the morning, then `/clear` and start a fresh session
on `docs/goals/BACKLOG.md`. This file is disposable — delete or
overwrite it once you've read it.

## What shipped (newest first, all committed, all suites green)

| Commit | What | Judge it by |
|---|---|---|
| ff1daef | e2e: 1 retry for a resizable-table drag flake | — (infra) |
| 002e9a6 | human-review: "Ask for these attributes" subset, not all | open the seeded review example, add a human-review step, set the subset |
| 63839b9 | list-lookup: explicit If-no-match (fail/continue/default) | list-lookup node's Inspector |
| f4ae037 | schedule: live cronstrue preview under the cron field | drag a schedule trigger, type a cron |
| eac4dea | ruleset: visual condition builder (same as Decision edges) | ruleset node's Inspector — the two-surface inconsistency is gone |
| f58bbd6 | typed output signatures on every canvas card (`→ HTTP response body`) | any workflow canvas |
| f5cc0bb | Review queue: resolved-outcome visibility + workflow filter | Review page after approving/denying |
| ca8a776 | UX polish 1 (zoom cap, single-line inputs, palette restyle) + goals framework + stale-badge one-click | new-workflow canvas; the palette; docs/goals/ |
| d7a266a | ADR-0026 code-execution (PROPOSED — needs your yes) + node maturity audit | docs/adr/0026, goal 0001's table |
| bd854aa | MCP LLM-authoring protocol (introspect/validate/mutate/run + live sync) | needs the dogfood demo, goal 0003 |
| c1b7d3f | DDD restructure: root → internal/services/*svc + e2e isolation guard | the repo tree; root is just main.go now |
| 27be96d | build-identity badge (bundle-vs-binary commit, not a clock) | the top-right badge |

## Decisions that need YOUR call (surfaced, not silently made)

1. **ADR-0026 (code execution) is `proposed`, not accepted** — accepting
   it resolves SPEC §1.1's OPEN command-execution reading, §6, and
   ADR-0023's global-vs-workflow guardrail question. Read the ADR's
   "What acceptance decides" section and say yes/no before goal 0004
   is implemented.
2. **The UX overhaul (goal 0001) is judged live, by you** — I did the
   objective parts (zoom, input types, palette casing/style, output
   signatures, node maturity). The subjective spacing audit and the
   live-run-state-on-canvas piece are deliberately left for you to
   direct against your prototype, since "I can only tell if it matches
   when I see it in action."

## The new workflow: docs/goals/

- `BACKLOG.md` — the one committed, reorderable priority queue. Reorder
  it freely; top = next.
- `NNNN-*.md` — one goal each (Goal/Plan/Acceptance), referencing SPEC
  rather than restating it. Delivered goals move to `archive/`.
- A fresh session's instruction is in CLAUDE.md ("Goal backlog"): take
  the top unchecked goal, read its file, Research→Plan→Implement.
- Adopted as a pattern after real research rejected the tools
  (spec-kit/task-master/OpenSpec/BMAD — reasons in BACKLOG.md's header).

## Current backlog order (reorder as you like)

1. 0001 authoring-surface overhaul — increments landed; remaining:
   live run state on canvas, spacing audit, mcp-tool-call schema editor
   (the last big node-maturity gap). UX-first.
2. 0002 review queue — filter + resolved shipped; remaining: sidebar
   pending count (needs a park/resolve event — noted in the goal file).
3. 0003 MCP authoring dogfood — flip the Settings toggle, I author a
   workflow live in your window. The protocol shipped (bd854aa); this
   is the "see it in action" you asked for.
4. 0004 code execution — blocked on your ADR-0026 yes.

## Known non-issues

- resizable-table drag test is flaky under full-suite load (pointer-
  event coalescing), retried once; passes isolated always.
- Your real desktop store (~/Library/Application Support/mill) picked
  up a few test run-history rows earlier when a rogue server without
  isolation env held port 8080 — cosmetic Activity/Runs clutter only,
  no definitions touched; the new e2e isolation guard (c1b7d3f)
  prevents recurrence.
- Model-economics rule is in CLAUDE.md: on Fable/Opus, delegate toil
  to Sonnet/Haiku with explicit model pins (the two agent defs in
  .claude/agents/ register after a Claude Code restart).

## To run the app fresh

`pkill -f "bin/mill$"` (close any stale window), then `task dev`. The
footer shows the running commit; a red STALE badge means an old binary
is behind a new bundle (click it to close, on desktop).
