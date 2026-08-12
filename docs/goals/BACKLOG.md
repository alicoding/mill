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
6. [x] [0028 — Public-repo hygiene](archive/0028-public-repo-hygiene.md)
   — DELIVERED 2026-08-12: README rewrite (truthful positioning +
   the toolchain prerequisites CLAUDE.md itself never states),
   SECURITY.md (GitHub PVR enabled live), CONTRIBUTING.md + bug-report
   issue template, OpenSSF Scorecard workflow + badge, golangci-lint
   first pass (gosec/bodyclose/noctx/revive/unparam) triaged to zero
   findings on both build-tag variants — one real bug fixed
   (`mcpserving.Serve` missing `ReadHeaderTimeout`), revive's
   exported/package-comments rules deliberately disabled (fights
   house style); dependency-review deny-licenses; elkjs EPL-2.0
   verdict recorded in SPEC §3; both literal `/Users/ali` paths
   de-literalized. Second lint pass (gocritic/prealloc/contextcheck/
   sqlclosecheck) named as explicit future work, not done here.
7. [x] [0029 — Dev-liveness honesty](archive/0029-dev-liveness-honesty.md)
   — DELIVERED 2026-08-12: third badge state amber `DEV · go-stale`
   (`frontend/src/app/goLiveness.ts` + `BuildIdentityBadge.tsx`),
   comparing `BuildInfo.BuiltAt` (the running binary's own executable
   mtime) against the newest `internal/**/*.go` mtime served by a
   vite dev-only middleware (`vite.config.ts`'s `goLivenessPlugin`) —
   chosen over a task-dev-heartbeat-file candidate since it needs no
   new watcher process; deliberately Go-source-mtime, never git HEAD,
   so it can't repeat goal 0019's false-alarm. `task dev`'s start
   sweep also clears an orphaned vite port and warns (non-blocking)
   below 2GB free disk. Pure comparison unit-tested
   (`goLiveness.test.ts`); the full live-wedge behavior entered
   `.claude/rules/testing.md`'s manual-only note.
8. [x] [0030 — Node standard](archive/0030-node-standard.md) —
   DELIVERED 2026-08-12: `.claude/rules/node-standard.md` (8-item
   checklist, citing n8n's community-node/UX/error-handling
   guidelines, Zapier's publishing requirements, Raycast's store
   checklist; explicit rejections + the credential rule +
   NodeType-versioning-is-latent note); `TestNodeTypes`
   (nodetypes_test.go) machine-checks 4 of the 8 items (Description
   non-empty, explicit Effect via a closed pureNodeTypes allow-list,
   universal Output, Kind-ID-prefix via a closed idPrefixExceptions
   allow-list) — the error-prefix convention stays review-checked,
   not grep-tested (fragility tradeoff recorded in the rule file).
   Audit found and fixed 3 real gaps: list-lookup/list-search/
   child-workflow had no declared Effect (silently defaulting to the
   permissive zero value), decision-route had no Output.
9. [ ] [0031 — AI node family](0031-ai-node-family.md) — owner-engaged
   2026-08-12: the guardrailed AI-node family (n8n/Make/Zapier/
   Dify taxonomy convergence), Mill's category-defining capability;
   research not started.
10. [ ] [0032 — Copy management](0032-copy-management.md) — owner-observed
    2026-08-12: 40 of 72 `.tsx` files carried inline hardcoded copy, no
    i18n library. Research + adopt decision DONE and library landed
    2026-08-12: `react-i18next` + `i18next`, namespace-per-bounded-
    context JSON (`frontend/src/locales/en/`), init wired in
    `app/i18n.ts`; `SettingsView.tsx` migrated as the proof-of-pattern
    slice. Deliberately left OPEN, not archived: the remaining ~39
    files are real, staged debt — see the four Standing tech-debt
    entries above (`app/`, `composition/`, `configure/`, `views/`
    minus Settings) for the rest of the migration.
11. [x] [0033 — Reload session restore](archive/0033-reload-session-restore.md)
    — DELIVERED 2026-08-12, owner-observed live: a real ⌘⇧R hard
    reload mid-session (tab 3 of 3) discarded the open tab and landed
    on Home. Root cause: `shared/store.ts`'s zustand `persist` already
    round-tripped `view` + the restorable work tabs through
    `localStorage` (built earlier, goal-adjacent to 0015/0018), but
    `activeWorkTabKey` was deliberately excluded — "restored present,
    never auto-activated" was the explicit prior design, which read as
    losing your place whenever the underlying sidebar `view` happened
    to be Home (opening a tab from Home's Most-Used list never touches
    `view`). Fixed: `activeWorkTabKey` now persists too, filtered/
    resolved through shared pure helpers (`shared/workTabs.ts`'s new
    `activeKeyIfPresent`/`restoreWorkTabSnapshot`/`pruneStaleWorkTabs`,
    unit-tested) so a reload restores the same page AND the same
    active tab; a stale snapshot (a workflow deleted since) degrades
    gracefully via the existing prune-on-load path. E2e-covered
    (`state-persistence.spec.ts`, 3 new/updated goal-0033 cases) incl.
    an explicit fresh/cleared-storage-still-boots-to-Home regression
    guard (goal 0019's original concern). SPEC.md §1 + §3.7/§3.8
    updated in the same change.

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
11. [ ] [0015 — Summon quick-invoke](0015-summon-quick-invoke.md) — CORE delivered 2026-08-11 (⌘K palette: commands with inline shortcuts, workflow run, tab jump/close; delegated build); PHASE 2 delivered same day (ADR-0033: the summon hotkey opens a dedicated floating Quick Panel — frameless, floats over fullscreen, Esc/blur dismiss, focus-yield; supersedes "summon opens the main window"). REMAINDER delivered 2026-08-12 (session 1), into the Quick Panel: frecency sort (frequency-only, `app/workflowFrecency.ts` off goal 0014's `HomeMetrics.mostUsed`), pending-review count (own window-local read+subscribe, `QuickPanel.tsx`), Configure entities as jumpable rows (`configure:<tab>` via new `app/useMillNavigate.ts` + `ConfigureView.initialTab`). INLINE-HOTKEY-HINT (command half) delivered 2026-08-12 (session 2): `app/HotkeyHint.tsx` (`resolveHotkeyLabel`/`useCommandBinding`/`<HotkeyHint>`), the ONE place every inline shortcut chip reads `shared/commands.ts` + `keybindingOverrides` from now (also absorbed CommandPalette's and QuickPanel's own prior independent copies); two new real, rebindable commands `tab.closeOthers` (⌘⌥W) / `tab.closeAll` (⌘⇧W) wired into `WorkTabShell.tsx`'s tab-overflow menu; proven in `e2e/hotkey-hint.spec.ts` including a rebind-in-Settings-updates-the-hint-elsewhere case. Still open, named in the goal file, not silently dropped: the ⌘K palette/Quick Panel's own inline-hotkey-per-WORKFLOW-TRIGGER-row detail (a distinct, still-unbuilt registry — a workflow's own Hotkey trigger combo, not an app-level command's); pins/favorites and the ⌘?/⌘/ multi-binding alias — see their own tech-debt lines below (Standing section).
12. [x] [0022 — Workflow view mode](archive/0022-workflow-view-mode.md) — delivered 2026-08-11 (row click → read-only canvas w/ Run+step-debug; Edit explicit in-place mode switch; breakpoint dot moved onto the node card, both modes; fixed a latent bug where a policy deny could hide a breakpoint's existence)
13. [x] [0020 — Workflow breakpoints](archive/0020-workflow-breakpoints.md) — delivered 2026-08-11 (ADR-0031 full scope incl. step mode + MCP debug tools; delegated build; found+fixed the ExecuteOptions.WorkflowID never-set bug that silently disabled all workflow/instance-scoped guardrail rules at runtime)

**Standing**
- [ ] E2e CI flake investigation (owner-directed 2026-08-12: "add to the backlog when problem found so that we prioritize to unblock us") — three distinct e2e specs have each independently failed once on a shard, then gone green on an immediate rerun, across three different PRs in one session: `resizable-table.spec.ts` (drag-handle bounding-box), `canvas-live-sync.spec.ts` (MCP `update_workflow` live-redraw assertion), and (Go side, same class) `TestMillMCPService_RealClientRoundTrip` (already fixed — its 2s `Shutdown` timeout was genuinely too tight for a loaded shared runner, bumped to 10s, PR #21). Each so far individually diagnosed as unrelated to the PR that triggered it and confirmed transient by a clean rerun — but three in one session is a real pattern worth investigating as a batch rather than re-diagnosing from scratch every time: is the shared macOS/ubuntu CI runner under-resourced for the current suite size, are these three specs sharing some real timing sensitivity (a fixed wait/assertion window too tight for runner variance), or is this the general shape more of the suite's specs have and will keep surfacing one at a time. DoR: pull the actual CI run history for these (and any other) specs' pass/fail/rerun rate over the last N runs before assuming root cause; DoD: either a fix (raise a shared timeout/wait pattern, add strategic retries per goal 0024's existing e2e-retry precedent) or, if genuinely just runner variance, a documented decision to accept it with reasoning, not silence.
- [ ] [0001 — Authoring-surface overhaul](0001-authoring-surface-overhaul.md) (spacing audit + §3.8 prototype elements — live-review material)
- [ ] [0021 — MCP dogfood gap closure](0021-mcp-dogfood-gap-closure.md) (owner-mandated 2026-08-11: orchestrator live-probes the MCP surface against the bank use cases, logs ranked gaps, fixes graduate out; **Phase 1 fully complete 2026-08-12** — all 4 gaps fixed/verified + 1 confirmed-by-design; Phase 2/3 still open, need live interactive probing not code changes)
- [ ] Workflow pins/favorites (tech debt, split from goal 0015's remainder 2026-08-12) — no pin/favorite concept exists anywhere in Mill today (grepped before scoping it out); needs its own small schema decision (which store owns a pin list, per-workflow or a plain ID set) before any build — deliberately not invented ad hoc under 0015's frecency-only ship. Quick Panel's workflow list sorts by frequency alone until this lands.
- [ ] ⌘?/⌘/ multi-binding keybinding alias (tech debt, split from goal 0015's remainder 2026-08-12) — the owner's goal-0015 "bind ⌘? (and/or ⌘/) to open the palette too" ask needs a command to carry more than one `KeyCombo`; today's registry (`shared/commands.ts`) is 1:1 (`defaultBinding: KeyCombo | null`). Needs a real schema call (array vs. a small alias table) before it's buildable — real data-model infrastructure, not a self-contained UI change.
- [ ] Copy-management migration — `app/` (tech debt, split from goal 0032 2026-08-12) — extract `app/`'s remaining hardcoded JSX copy (App.tsx's shell chrome, QuickPanel/QuickPanelApp, ApprovalPromptApp, workflowFrecency-adjacent UI, etc. — ~11 files carry inline strings) into `frontend/src/locales/en/app.json` (already scaffolded, currently `{}`) following `SettingsView.tsx`'s established pattern (`useTranslation()`/`t()`, namespace-per-bounded-context). DoR: read `docs/goals/0032-copy-management.md` for the locked i18n pattern before starting — no new library/schema decision needed, this is mechanical extraction. DoD: every `app/*.tsx` file free of inline user-facing string literals in JSX (aria-labels included), `app.json` populated, existing e2e specs touching `app/` still pass unchanged (translated text must match original English exactly).
- [ ] Copy-management migration — `composition/` (tech debt, split from goal 0032 2026-08-12) — same extraction as above, scoped to `composition/`'s ~22 files with inline copy (canvas node cards, palette, validation messages, trigger/schedule UI) into `frontend/src/locales/en/composition.json`. Largest of the four remaining slices — consider whether it splits further once started (per-node-type vs. whole-folder) rather than treating it as one atomic PR. Same DoR/DoD shape as the `app/` entry above.
- [ ] Copy-management migration — `configure/` (tech debt, split from goal 0032 2026-08-12) — same extraction, scoped to `configure/`'s ~14 files (connector/list/MCP-server forms, OpenAPI synth UI) into `frontend/src/locales/en/configure.json`. Same DoR/DoD shape as the `app/` entry above.
- [ ] Copy-management migration — `views/` minus Settings (tech debt, split from goal 0032 2026-08-12) — same extraction, scoped to the remaining `views/*.tsx` files (Settings already migrated into `views.json`'s `settings` namespace) — add sibling namespaces (e.g. `views.json`'s `home`, `activity`, etc. keys) per view. Same DoR/DoD shape as the `app/` entry above. Once all four of these land, revisit `eslint-plugin-i18next`'s `no-literal-string` rule (evaluated and deliberately deferred in goal 0032 — see `docs/SPEC.md`'s copy-management bullet) as a guard against regression.

**Delivered**
- [x] [0003 — MCP authoring live dogfood](archive/0003-mcp-authoring-dogfood.md) — 2026-08-10
- [x] [0006 — Trigger-aware Workflows list](0006-trigger-aware-workflows-list.md) — 2026-08-10
- [x] [0007 — Resource-inventory redesign](0007-resource-inventory-redesign.md) — 2026-08-10 (owner recognition test passed live: "like an addition")
12. [x] [0016 — Keymap system](archive/0016-keymap-system.md) — delivered 2026-08-10 (command registry, Settings rebinding, ⌘W→tab, Run=⌘↩; 127/127)
- [x] [0017 — Real-time surfaces audit](archive/0017-realtime-surfaces-audit.md) — delivered 2026-08-12 (root cause: only mcpsvc emitted mill-data-changed; gave CompositionService/ConfigureService/GuardrailService their own dataevent.Emit, fixed App.tsx's list/mcpserver misrouting, added a lists/decisions/mcpServers/execEnvs shared store, wired run/workflow/guardrail-rule subscribers across WorkflowRunsPanel/Home/ActivityRunsExplorer/CompositionView/useGuardrailBadges/ReviewView)
