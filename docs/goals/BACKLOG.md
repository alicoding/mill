# Goal backlog — the one committed priority queue

Hand-reorderable: the order below IS the priority (top = next). The
standing tiebreak is **UX/frontend first** — quick visible iteration
beats backend depth when both are ready (direct owner decision).

How a session picks up work: take the top unchecked goal, read its
`NNNN-*.md` file, follow Research → Plan → Implement (CLAUDE.md), and
move the file to `archive/` when its acceptance criteria are met — in
the same commit as the last change that meets them.

This file is the delivery queue only. Requirements stay in
`docs/SPEC.md` (the goal files reference it, never restate it);
decisions stay in `docs/adr/`; conventions stay in `.claude/rules/`.

Adopted as a pattern, not a tool (researched: spec-kit wants to own
the spec and adds a Python toolchain; task-master is a 61-dependency
JSON database; OpenSpec's own maintainers hand-write exactly this kind
of ordering file because no tool automates it — see goal 0000's note
in archive/ for the full verdict trail if ever needed).

## Queue

1. [ ] [0001 — Authoring-surface overhaul](0001-authoring-surface-overhaul.md) (UX)
2. [ ] [0002 — Review queue maturation](0002-review-queue-maturation.md) (UX)
3. [x] [0003 — MCP authoring live dogfood](archive/0003-mcp-authoring-dogfood.md) — delivered 2026-08-10, live with the owner (full loop incl. refused-while-off, per-write approval, auto-snapshot)
4. [ ] [0004 — Code execution capability](0004-code-execution-capability.md) (backend; ADR-0026 accepted 2026-08-10 — implementation unblocked)
