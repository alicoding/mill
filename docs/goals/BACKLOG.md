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

Reprioritized 2026-08-11 (owner asked for the backlog to always carry
the right order; session-born work reconciled into goal files the same
day — see the header rule below). Standing rule, added to CLAUDE.md's
backlog section in the same commit: **work discovered mid-session that
outlives the session gets a goal file and a queue position before the
session ends — never left only in an ephemeral session task list.**

**Group D — Trust the substrate (2026-08-11, owner-mandated: "do it
properly once"; ordered first because everything else ships through
this pipeline and on this code)**
1. [ ] [0024 — CI/CD target architecture + operating model](0024-cicd-target-architecture.md)
   — IN FLIGHT: catch-up pushed, e2e triage + target-architecture
   build land next, then the ruleset on a green main (ADR-0034)
2. [x] [0025 — Substance hardening](archive/0025-substance-hardening.md) — DELIVERED 2026-08-12 (both audit waves + LOW items) —
   fix the audited green-but-wrong class (12 silent persistence
   sites, unfailable test fake, uncovered safety-badge source);
   frontend half already largely clean
3. [x] [0023 — Attention escalation](archive/0023-attention-escalation.md) —
   delivered: floating approval prompt (ADR-0033's mechanism reused,
   `#/approvalprompt`), idle-aware presence gate (`internal/adapters/idletime`,
   backend-side `isAway`), alert-style authorization request (notify.Start),
   cross-device forward (`composition.SendJSONWebhook`,
   `ForwardPendingApproval`) — see ADR-0032's Update note
4. [x] [0026 — Request lifecycle honesty](archive/0026-request-lifecycle-honesty.md)
   — delivered 2026-08-12: `cancel_write` MCP tool (a distinct
   outcome from denied, ungated, at-most-once); age-tiered staleness
   presentation (Review/banner/floating prompt) + "expires in Nh";
   requester-liveness hint (`lastPolledAt`, >5m-stale gate); the
   phantom-badge BUG fixed (every resolution path — approve/deny/
   cancel/expiry — now pings the pending-changed signal, found live:
   an empty-struct payload silently failed Wails3's own registered-
   event type check); resolved MCP writes now durable in Review's
   Recently-resolved; Activity MCP-write rows are expandable with a
   jump-to-workflow preview; stuck-ENQUEUED runs get age emphasis +
   Stop in WorkflowRunsPanel/Activity's runs explorer. Item 4
   (session-side hygiene) intentionally not a Mill code change.
5. [x] [0027 — Core vs composition boundary](archive/0027-core-vs-composition-boundary.md)
   — DELIVERED 2026-08-12: ADR-0035's build half — `trigger-system-event`
   unparked (four events, loop-rule enforced at emission), the forward
   refactored from a Settings toggle + private send path into a seeded,
   editable "Example: Forward pending approvals" workflow; the decision
   test written into `.claude/rules/architecture.md`; SettingsView's
   silent-mount-fetch class fixed alongside.
6. [ ] [0028 — Public-repo hygiene](0028-public-repo-hygiene.md) —
   research delivered 2026-08-12 (community-profile score 28%,
   exposure sweep clean, LICENSE already correct); the close-the-gaps
   build (README/SECURITY/CONTRIBUTING/Scorecard/lint hardening) not
   started.
7. [ ] [0029 — Dev-liveness honesty](0029-dev-liveness-honesty.md) —
   the DEV·live badge's Go-liveness blind spot, now having claimed a
   second scalp (ADR-0035's Consequences note); a third badge state
   (amber DEV·go-stale) not yet built.
8. [ ] [0030 — Node standard](0030-node-standard.md) — owner-mandated
   2026-08-12: a written, precedent-researched (n8n community-node
   review) conformance standard every NodeType is checked against;
   not started.
9. [ ] [0031 — AI node family](0031-ai-node-family.md) — owner-engaged
   2026-08-12: the guardrailed AI-node family (n8n/Make/Zapier/
   Dify taxonomy convergence), Mill's category-defining capability;
   research not started.

**Ratified 2026-08-10 (owner): three groups, A→B→C. 0001 stays standing
live-review material, interleaved during owner reviews, not a lane.**

**Group A — Foundation**
1. [x] [0009 — E2e parallel isolation](archive/0009-e2e-parallel-isolation.md) — delivered 2026-08-10: 107/107 ×3 at 42-49s (was ~10min serial); double-run discipline retired structurally
2. [x] [0010 — Seed-proof completeness + enforcement](archive/0010-seed-proof-completeness.md) — delivered 2026-08-10: every seed proven or explicitly manual-only; enforcement red-builds proofless seeds; 3 new seeds (List lookup, MCP echo, disabled fs-watch); advisory liveness CI

**Group B — Execution arc**
3. [x] [0008 — Authoring validation + ending model](archive/0008-authoring-validation-and-ending-model.md) — delivered 2026-08-10 (ADR-0028 + full build: issue list, badges, panel, MCP validate-all; 115/115)
4. [x] [0004 — Code execution capability](0004-code-execution-capability.md) (ADR-0026 + amendments = complete brief; ~two agent builds)

**Group C — Attention layer**
5. [x] [0005 — Pending-attention model](0005-pending-attention-model.md) — core delivered 2026-08-10 (unified guardrail event + sidebar badge + traceless-timeout fix; OS-notification future named)
6. [x] [0002 — Review queue maturation](archive/0002-review-queue-maturation.md) — DELIVERED 2026-08-12 (kind filter over four pending kinds, Blankslate/loading polish; badge came via 0005)

**Unscheduled (reorder into a group when prioritized)**
7. [x] [0012 — Authoring hot-exit](archive/0012-authoring-hot-exit.md) — canvas half delivered 2026-08-10 (scratch persistence + restored-unsaved banner + dirty dots; Configure forms recorded-remaining in the archived file)
8. [x] [0013 — Canonical type system](archive/0013-canonical-type-system.md) — COMPLETE 2026-08-10 (typedfield leaf pkg; all 4 vocabularies converged incl. openapispec Phase 3; the #1 kernel investment)
9. [x] [0011 — Lists maturation](archive/0011-lists-maturation.md) — DELIVERED 2026-08-12 (harvested from a parallel owner session + reconciled onto main: typed Columns/Rows against ADR-0029's canonical typedfield, system-managed audit columns w/ Expired-excluded-by-default, `list-search` node w/ go-edlib fuzzy matching, in-place legacy-List migration; CSV import + full per-run dataset snapshot named-deferred)
10. [x] [0014 — Home dashboard / value mirror](archive/0014-home-dashboard.md) — delivered 2026-08-10 (Recharts, industry-decided metric semantics, editable minutes-saved, default landing)
11. [ ] [0015 — Summon quick-invoke](0015-summon-quick-invoke.md) — CORE delivered 2026-08-11 (⌘K palette: commands with inline shortcuts, workflow run, tab jump/close; delegated build); PHASE 2 delivered same day (ADR-0033: the summon hotkey opens a dedicated floating Quick Panel — frameless, floats over fullscreen, Esc/blur dismiss, focus-yield; supersedes "summon opens the main window"). Remainder open: frecency/pins (needs the 0014 usage substrate), Configure entities, pending-review count, ⌘?/⌘/ alias (needs multi-binding registry support)
12. [x] [0022 — Workflow view mode](archive/0022-workflow-view-mode.md) — delivered 2026-08-11 (row click → read-only canvas w/ Run+step-debug; Edit explicit in-place mode switch; breakpoint dot moved onto the node card, both modes; fixed a latent bug where a policy deny could hide a breakpoint's existence)
13. [x] [0020 — Workflow breakpoints](archive/0020-workflow-breakpoints.md) — delivered 2026-08-11 (ADR-0031 full scope incl. step mode + MCP debug tools; delegated build; found+fixed the ExecuteOptions.WorkflowID never-set bug that silently disabled all workflow/instance-scoped guardrail rules at runtime)

**Standing**
- [ ] [0001 — Authoring-surface overhaul](0001-authoring-surface-overhaul.md) (spacing audit + §3.8 prototype elements — live-review material)
- [ ] [0021 — MCP dogfood gap closure](0021-mcp-dogfood-gap-closure.md) (owner-mandated 2026-08-11: orchestrator live-probes the MCP surface against the bank use cases, logs ranked gaps, fixes graduate out; phase 1 done — 4 gaps + 1 confirmed-by-design)

**Delivered**
- [x] [0003 — MCP authoring live dogfood](archive/0003-mcp-authoring-dogfood.md) — 2026-08-10
- [x] [0006 — Trigger-aware Workflows list](0006-trigger-aware-workflows-list.md) — 2026-08-10
- [x] [0007 — Resource-inventory redesign](0007-resource-inventory-redesign.md) — 2026-08-10 (owner recognition test passed live: "like an addition")
12. [x] [0016 — Keymap system](archive/0016-keymap-system.md) — delivered 2026-08-10 (command registry, Settings rebinding, ⌘W→tab, Run=⌘↩; 127/127)
13. [ ] [0017 — Real-time surfaces audit](0017-realtime-surfaces-audit.md) (product value locked in SPEC §1: never make the user refresh; audit every surface for stale state, fix via the existing event layer)
