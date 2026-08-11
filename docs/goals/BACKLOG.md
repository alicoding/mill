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
4. [x] [0004 — Code execution capability](0004-code-execution-capability.md) (ADR-0026 + amendments = complete brief; ~two agent builds)

**Group C — Attention layer**
5. [x] [0005 — Pending-attention model](0005-pending-attention-model.md) — core delivered 2026-08-10 (unified guardrail event + sidebar badge + traceless-timeout fix; OS-notification future named)
6. [ ] [0002 — Review queue maturation](0002-review-queue-maturation.md) (remainder: pending badge built on 0005's eventing; kind filter/polish)

**Unscheduled (reorder into a group when prioritized)**
7. [x] [0012 — Authoring hot-exit](archive/0012-authoring-hot-exit.md) — canvas half delivered 2026-08-10 (scratch persistence + restored-unsaved banner + dirty dots; Configure forms recorded-remaining in the archived file)
8. [x] [0013 — Canonical type system](archive/0013-canonical-type-system.md) — COMPLETE 2026-08-10 (typedfield leaf pkg; all 4 vocabularies converged incl. openapispec Phase 3; the #1 kernel investment)
9. [ ] [0011 — Lists maturation](0011-lists-maturation.md) (typed datasets + List Search per SPEC §3.2.2's reference review; evidence-gap research first)
10. [x] [0014 — Home dashboard / value mirror](archive/0014-home-dashboard.md) — delivered 2026-08-10 (Recharts, industry-decided metric semantics, editable minutes-saved, default landing)
11. [ ] [0015 — Summon quick-invoke](0015-summon-quick-invoke.md) — CORE delivered 2026-08-11 (⌘K palette: commands with inline shortcuts, workflow run, tab jump/close; delegated build). Remainder open: frecency/pins (needs the 0014 usage substrate), Configure entities, pending-review count, ⌘?/⌘/ alias (needs multi-binding registry support)
12. [x] [0020 — Workflow breakpoints](archive/0020-workflow-breakpoints.md) — delivered 2026-08-11 (ADR-0031 full scope incl. step mode + MCP debug tools; delegated build; found+fixed the ExecuteOptions.WorkflowID never-set bug that silently disabled all workflow/instance-scoped guardrail rules at runtime)

**Standing**
- [ ] [0001 — Authoring-surface overhaul](0001-authoring-surface-overhaul.md) (spacing audit + §3.8 prototype elements — live-review material)

**Delivered**
- [x] [0003 — MCP authoring live dogfood](archive/0003-mcp-authoring-dogfood.md) — 2026-08-10
- [x] [0006 — Trigger-aware Workflows list](0006-trigger-aware-workflows-list.md) — 2026-08-10
- [x] [0007 — Resource-inventory redesign](0007-resource-inventory-redesign.md) — 2026-08-10 (owner recognition test passed live: "like an addition")
12. [x] [0016 — Keymap system](archive/0016-keymap-system.md) — delivered 2026-08-10 (command registry, Settings rebinding, ⌘W→tab, Run=⌘↩; 127/127)
13. [ ] [0017 — Real-time surfaces audit](0017-realtime-surfaces-audit.md) (product value locked in SPEC §1: never make the user refresh; audit every surface for stale state, fix via the existing event layer)
