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

Ratified 2026-08-10 (owner): three groups, A→B→C. 0001 stays standing
live-review material, interleaved during owner reviews, not a lane.

**Group A — Foundation**
1. [x] [0009 — E2e parallel isolation](archive/0009-e2e-parallel-isolation.md) — delivered 2026-08-10: 107/107 ×3 at 42-49s (was ~10min serial); double-run discipline retired structurally
2. [x] [0010 — Seed-proof completeness + enforcement](archive/0010-seed-proof-completeness.md) — delivered 2026-08-10: every seed proven or explicitly manual-only; enforcement red-builds proofless seeds; 3 new seeds (List lookup, MCP echo, disabled fs-watch); advisory liveness CI

**Group B — Execution arc**
3. [x] [0008 — Authoring validation + ending model](archive/0008-authoring-validation-and-ending-model.md) — delivered 2026-08-10 (ADR-0028 + full build: issue list, badges, panel, MCP validate-all; 115/115)
4. [ ] [0004 — Code execution capability](0004-code-execution-capability.md) (ADR-0026 + amendments = complete brief; ~two agent builds)

**Group C — Attention layer**
5. [ ] [0005 — Pending-attention model](0005-pending-attention-model.md) (research/design first — owns the park/resolve eventing)
6. [ ] [0002 — Review queue maturation](0002-review-queue-maturation.md) (remainder: pending badge built on 0005's eventing; kind filter/polish)

**Unscheduled (reorder into a group when prioritized)**
7. [ ] [0012 — Authoring hot-exit](0012-authoring-hot-exit.md) (owner requirement: no data loss on quit/close — VS Code hot-exit model for unsaved canvas/form state; pairs with the recorder-accelerator fix)
8. [ ] [0013 — Canonical type system](0013-canonical-type-system.md) (platform kernel: converge the four field vocabularies; ADR first; sequence after 0004 or when 0011 forces typed payloads)
9. [ ] [0011 — Lists maturation](0011-lists-maturation.md) (typed datasets + List Search per SPEC §3.2.2's reference review; evidence-gap research first)
10. [ ] [0014 — Home dashboard / value mirror](0014-home-dashboard.md) (the value mirror — owner's reason-to-open; shares the usage-stats substrate with 0015)
11. [ ] [0015 — Summon quick-invoke](0015-summon-quick-invoke.md) (⌘K palette on FilteredActionList; teaches hotkeys inline; frecency from the same usage substrate as 0014)

**Standing**
- [ ] [0001 — Authoring-surface overhaul](0001-authoring-surface-overhaul.md) (spacing audit + §3.8 prototype elements — live-review material)

**Delivered**
- [x] [0003 — MCP authoring live dogfood](archive/0003-mcp-authoring-dogfood.md) — 2026-08-10
- [x] [0006 — Trigger-aware Workflows list](0006-trigger-aware-workflows-list.md) — 2026-08-10
- [x] [0007 — Resource-inventory redesign](0007-resource-inventory-redesign.md) — 2026-08-10 (owner recognition test passed live: "like an addition")
