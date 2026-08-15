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

**Group F — Real-use fidelity + rhythm (2026-08-13, owner-picked all
four in the post-0041 planning round; this order recommended and
accepted)**
1. [x] [0042 — Markdown fidelity pass 2](archive/0042-markdown-fidelity-pass-2.md)
   — implemented the five pinned Confluence degradations (language
   hints, task lists, emoji fallback, panel types, expand→details) as
   custom renderers on the converter; corpus + goldens from PR #78
   were the proof harness
2. [x] [0048 — Unsaved-changes close guard](archive/0048-unsaved-close-guard.md)
   — DELIVERED: implemented 2026-08-13 (PR #95, all acceptance items
   test-proven), owner live sign-off 2026-08-14 ("close guard
   worked"). VS Code-precedent Save/Don't save/Cancel on single
   close, summary confirm on bulk, every mouse+keyboard path through
   one guarded funnel. Its archive is the v0.3.0 release trigger per
   SPEC §1.3's cadence rule
3. [ ] [0043 — Hotkey recorder vs menu accelerators](0043-hotkey-recorder-menu-accelerators.md)
   — overdue owner-hit bug (⌘⇧W while recording closed the app);
   accelerator-free menu swap during capture
4. [ ] [0044 — M365 bridge dry run + capture research](0044-m365-bridge-dry-run.md)
   — absorbs goal 0021 Phase 4's last bullet; gap list + the
   browser-extension-at-a-locked-down-enterprise decision research
5. [x] [0053 — "Step", not "node": vocabulary rename](archive/0053-step-vocabulary.md)
   — owner-ratified 2026-08-13 ("a step in the workflow, not a node
   in the workflow"; generic without being engineer-only; run
   history already says step). UI copy sweep here; wire names land
   inside 0052 (sequenced before it so the contract never freezes
   the rejected word); internal identifiers untouched.
   DELIVERED 2026-08-14: UI sweep PR #110; wire tier landed inside
   0052's freeze (PR #123 -- steps/StepTypeID with legacy aliases
   forever, list_step_types primary). ARCHIVED
6. [x] [0057 — Live-sync audit: no reload, ever](archive/0057-live-sync-audit.md)
   — DELIVERED 2026-08-14, same day raised (owner-directed after the
   runs-panel staleness hit live). Runs-panel fix (PR #111) + full
   audit (PR #113): three run-lifecycle emits (ResolveApproval/
   CancelRun/RedriveRun), new hotkey/keybinding entity vocabulary
   wired through five previously fetch-once surfaces, TestHook-seam
   emit coverage for EVERY mutating service package, both suspicious
   surface families live-verified. Two deliberate polls (step
   progress, in-flight detail) recorded as design, not gaps
7. [x] [0052 — Contract maturity: generated schema + versioned envelope](archive/0052-contract-surface.md)
   — owner-directed 2026-08-13 ("follow the mature pattern") after
   the far-side contact: schema-first discipline adopted as generated
   JSON Schema from Go types (protobuf/gRPC/OpenAPI rejected with
   reasons in the goal file); absorbs 0044's far-side gaps 1/2/4 +
   the export-id open question; evidence receipt rides as item 5;
   coordinates schema-id evolution semantics with 0046's ADR.
   Sequenced directly after 0044 — the dry run sharpens what the
   contract must express. DELIVERED 2026-08-14 in four slices
   (PRs #117/#118/#119/#123): 8 schema families + drift gates,
   export id + uniform import, manifest, root contract document,
   discovery filter, receipt step, step wire vocabulary. ARCHIVED.
   **PENDING OWNER CALL: 0052 is a capability-goal archive, so the
   cadence rule says tag v0.4.0 — held because v0.3.0 shipped the
   same day; ask the owner before cutting. Known remainder for a
   future sweep: node wording in MCP debug-tool descriptions + the
   root document's nodeTypes key (PR #123's flagged leftovers)**
8. [x] [0058 — Step inspector UX: config + I/O together](archive/0058-step-inspector-ux.md)
   — owner-raised 2026-08-14 ("the tiny sidebar for everything seems
   to be a weird difficult pattern"): review-first goal — precedent
   research on step detail surfaces (the field converged on
   config-beside-data at working size, not narrow sidebars), verdict
   recorded, then implement over existing recorded step I/O + the
   generic ConfigField inspector. DELIVERED 2026-08-14: three-pane
   `StepDetailOverlay.tsx` (Primer `Dialog` at a custom CSS width),
   `NodeConfigFields.tsx` extracted so the sidebar and overlay share
   one config-rendering implementation, latest-run data via
   `useLatestRunStep.ts`. ARCHIVED
9. [x] [0059 — Empty states that stay useful](archive/0059-empty-states-useful.md)
   — owner-raised 2026-08-14 from live screenshots (Activity's
   one-line void vs Review's half-working pattern): every empty
   state gets the kit's full Blankslate anatomy with a real
   navigating action; copy pass rides along. DELIVERED 2026-08-14
   same day raised (PR #128): nine surfaces inventoried, four gained
   navigating actions, Review's no-action call reasoned, Activity
   spec-aside reworded. ARCHIVED
10. [ ] [0060 — Everyday value map](0060-everyday-value-map.md)
   — owner-raised 2026-08-14 ("I can't explain to my wife how it's
   useful"): research-only — the attended/desktop-automation field
   (Shortcuts/Keyboard Maestro/AutoHotkey/PAD galleries) mined for
   what non-developers actually automate; everyday-task inventory
   mapped to today/needs-step/out-of-boundary; the one-sentence
   explanation test. Feeds 0056 + 0047
11. [x] [0054 — Step designer + declare-vs-code boundary](archive/0054-step-designer.md)
   — owner-directed 2026-08-13: declare new step types in-product
   (v1 = promote HTTPRequest operations / MCP tools / child
   workflows into named palette types, stored as data) + the ADR
   ratifying WHEN code is genuinely required (new engine) vs
   declaration suffices (naming/mapping over existing engines).
   After 0052 — declared types must be first-class in the generated
   contract from day one; benefits from 0047's palette facet.
   DELIVERED 2026-08-14/15 (ADR-0037 + PRs #132/#134): declare-vs-code
   boundary recorded, data-backed registry with inherited effect
   classes, Configure designer page, live palette, seeded proof.
   ARCHIVED — second capability-goal archive stacked on the pending
   v0.4.0 owner call (one release covers 0052+0054).
   **Slice A (backend: data-backed registry, Configure entity,
   contract family, seeded proof) shipped — see the goal file's own
   "Slice A status" section. Remaining: slice B, the designer UI.**
12. [x] [0055 — Canvas note block](0055-canvas-note-block.md)
   — owner-raised 2026-08-14 (n8n sticky-note precedent): annotation
   in the authoring space; not a step (no ports/execution); rides
   the workflow envelope, so coordinates with 0052's schema.
   DELIVERED 2026-08-14: `composition.Note`, its own `UpdateNotes` RPC,
   ADDITIVE-OPTIONAL envelope field (ADR-0036), a distinct React Flow
   node type with `NodeResizer`, seeded on "Example: Scratch capture"
   (SeedRevision 1→2). NOT ARCHIVED (goal file kept in place per this
   session's instruction).
13. [ ] [0056 — Workbench boundary definition](0056-workbench-boundary.md)
   — owner-raised 2026-08-14 ("we never truly defined what Mill
   boundary to be"): the POSITIVE product statement — capture lands
   somewhere useful, grouped, findable, transformable, every
   category user-declared. Design-only goal: research + capability
   map + SPEC §0/ADR; the unifying insight is that notes/pages/
   contacts/links differ only in schema+routing (one collections
   capability, never N hardcoded verticals — anti-goal recorded);
   build goals queue after its verdict
14. [x] [0045 — v0.2.0 + release cadence](archive/0045-release-cadence.md)
   — DELIVERED 2026-08-13: cadence rule LOCKED in SPEC §1.3
   (tag-on-capability-goal-archive; the asset is the launchable
   mill.app zip, clone-build stays the documented dev path); v0.2.0
   live and attestation-verified. The cut surfaced and fixed three
   more latent defects (raw-binary asset, release.yml invalid YAML —
   now gated by workflow-lint, GPL-3 setup-task action wrapper)
15. [ ] [0051 — Run-analytics dashboard v2](0051-run-analytics-dashboard.md)
   — owner-directed 2026-08-13; research DELIVERED same day (n8n/
   Zapier/Make/Windmill/Temporal/Airflow/Power Automate survey): Home
   already covers most of the converged set; ships avg-duration KPI +
   per-workflow duration column (no schema change), trigger-recency
   insight (workflow-level proxy), node-type failure breakdown on
   Activity; two data-model gaps recorded as deferred (per-step
   timestamps, trigger fire-log). Slotted ahead of 0049/0050 per the
   UX-first tiebreak
16. [ ] [0049 — Docs anti-rot mechanics](0049-docs-anti-rot.md)
   — owner-ratified 2026-08-13 from the two-agent docs survey: path-
   reference checker (lefthook+CI), generated ADR index with
   drift-fail, revive package-comments floor, AGENTS.md interop,
   README Spec-view fix; rejected list recorded in the goal file
17. [ ] [0050 — Codebase structure audit](0050-codebase-structure-audit.md)
   — owner-raised 2026-08-13 (OSS flat-structure critique): audit
   layout against official Go guidance + what OSS reviewers actually
   flag, verdict table + a citable layout ADR; only audit-justified
   moves, no conformance churn
18. [ ] [0046 — Schema evolution](0046-schema-evolution.md) —
   owner-raised from a real regulated-platform incident
   (rename-forbidden / retype-permanent / live-referenced decisions
   forcing a ~30-version manual cleanup); research delivered
   2026-08-13 with a five-part design sketch reusing ADR-0021's
   versioning, seeding's tombstones, and the Field Key/Label split;
   opens with the ADR that decides the semantics. Verified gap:
   Mill's Configure entities are live-referenced (a pinned workflow
   still resolves TODAY's decision definition) and deletes have no
   reference-integrity check
19. [ ] [0047 — Node audience/complexity facet](0047-node-audience-facet.md)
   — owner-proposed; session recommendation recorded: function stays
   the primary palette grouping, audience/complexity becomes a
   NodeType metadata field + progressive-disclosure facet (not a
   "for business users" taxonomy); policy-gated node availability
   deferred with a multi-user trigger

**Group E — Public-repo hygiene (2026-08-13, owner-directed: source
comments explain code per standard practice — business/product
decisions and the owner's own words live in docs/, cited by id, never
inline in source)**
0. [x] [0041 — OSS trust standards](archive/0041-oss-trust-standards.md) —
   DELIVERED 2026-08-13, same day opened: peer-calibrated research
   (fzf/bat/glow/cli-cli live Scorecard + community profiles) split
   every gap into adopt/defer-with-trigger/reject-with-reason — all
   recorded in the archived file. Shipped: all 5 OSV vulnerability
   findings cleared, Token-Permissions fixed, container images
   digest-pinned + docker Dependabot, CodeQL (zero findings in own
   code), PR template, repo description+topics, and the
   owner-approved **v0.1.0 release** — whose three-attempt delivery
   itself surfaced and fixed two real latent defects (headless
   bindings-generation app launch, and the build task's
   backtick-substitution echo that executed `task run` — the probable
   source of Standing #8's phantom dev instances). Release live with
   provenance attestation verified against the downloaded asset.
1. [x] [0038 — Comment hygiene: constraints, not narrative](archive/0038-comment-hygiene.md) — delivered 2026-08-13
   — rule (`.claude/rules/comments.md`) + gate
   (`check-comment-hygiene.sh`, lefthook + CI `comment-hygiene` job in
   `ci-gate`) + one sweep of the 65 baseline narrative comments
2. [x] [0040 — UX copy voice: product copy, not spec narrative](archive/0040-ux-copy-voice.md) — delivered 2026-08-13
   — rule (`.claude/rules/ux-writing.md`) + gate (`check-ui-copy.sh`:
   no internal doc refs in locale JSON, 13 baseline) + sweep of the 13
   gate violations, 3 vendor-name explanations, and ~35 over-length/
   subtitle strings across `frontend/src/locales/en/*.json`

**Group D — Trust the substrate (2026-08-11, owner-mandated: "do it
properly once"; ordered first because everything else ships through
this pipeline and on this code)**
1. [x] [0024 — CI/CD target architecture + operating model](archive/0024-cicd-target-architecture.md)
   — DELIVERED, closed 2026-08-13: all file-level work had landed
   progressively (green maiden run 2026-08-12, budgets/sharding/
   path-filtering/SHA-pinning); the last open item (ruleset +
   direct-push dry-run) verified live — ruleset 20723094 active,
   dry-run push rejected (GH013), docs-only PR #45 fast-skipped
   with "CI gate" green; all three acceptance predicates evidenced
   in the archived goal file
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
9. [x] [0031 — AI node family](archive/0031-ai-node-family.md) —
   DELIVERED 2026-08-12 across two PRs (entity+adapters+ai-completion,
   then ai-extract-structured+ai-classify) — see the Standing list's
   own entry below for the full delivery writeup.
10. [x] [0032 — Copy management](archive/0032-copy-management.md) —
    DELIVERED 2026-08-12. Owner-observed: 40 of 72 `.tsx` files carried
    inline hardcoded copy, no i18n library. `react-i18next` + `i18next`
    adopted, namespace-per-bounded-context JSON
    (`frontend/src/locales/en/{common,app,composition,configure,
    views}.json`), init wired in `app/i18n.ts`; `SettingsView.tsx`
    migrated as the proof-of-pattern slice, then the remaining four
    slices landed as five sequential PRs (`app/`; `composition/` split
    further into panels/canvas/inspector sub-PRs, its own ~6600
    non-test lines the largest slice; `configure/`; `views/` minus
    Settings) — every `.tsx`/`.ts` file across `frontend/src/{app,
    composition,configure,views}` free of inline user-facing string
    literals (aria-labels/placeholders/titles included), translated
    text matching the original English exactly so existing e2e
    assertions kept passing unchanged. `eslint-plugin-i18next`'s
    `no-literal-string` rule (deliberately deferred until the gap
    closed) now wired into `frontend/eslint.config.js` in
    `jsx-text-only` mode as the regression guard, catching (and this
    same change fixing) five genuine leftovers in `shared/` along the
    way. `docs/SPEC.md`'s copy-management bullet updated to
    migrated-fully + guard-rule status.
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
11. [x] [0015 — Summon quick-invoke](archive/0015-summon-quick-invoke.md) — CORE delivered 2026-08-11 (⌘K palette: commands with inline shortcuts, workflow run, tab jump/close; delegated build); PHASE 2 delivered same day (ADR-0033: the summon hotkey opens a dedicated floating Quick Panel — frameless, floats over fullscreen, Esc/blur dismiss, focus-yield; supersedes "summon opens the main window"). REMAINDER delivered 2026-08-12 (session 1), into the Quick Panel: frecency sort (frequency-only, `app/workflowFrecency.ts` off goal 0014's `HomeMetrics.mostUsed`), pending-review count (own window-local read+subscribe, `QuickPanel.tsx`), Configure entities as jumpable rows (`configure:<tab>` via new `app/useMillNavigate.ts` + `ConfigureView.initialTab`). INLINE-HOTKEY-HINT (command half) delivered 2026-08-12 (session 2): `app/HotkeyHint.tsx` (`resolveHotkeyLabel`/`useCommandBinding`/`<HotkeyHint>`), the ONE place every inline shortcut chip reads `shared/commands.ts` + `keybindingOverrides` from now (also absorbed CommandPalette's and QuickPanel's own prior independent copies); two new real, rebindable commands `tab.closeOthers` (⌘⌥W) / `tab.closeAll` (⌘⇧W) wired into `WorkTabShell.tsx`'s tab-overflow menu; proven in `e2e/hotkey-hint.spec.ts` including a rebind-in-Settings-updates-the-hint-elsewhere case. Pins/favorites and the ⌘?/⌘/ multi-binding alias — their own tech-debt lines in the Standing section — both DELIVERED 2026-08-13. GOAL CLOSED 2026-08-13: the last item, the ⌘K palette/Quick Panel's own inline-hotkey-per-WORKFLOW-TRIGGER-row detail, landed via `app/WorkflowRowTrailingVisual.tsx` (shared by both surfaces) rendering `shared/KeyComboChip.tsx` off `TriggerService.ListHotkeys()`; a new e2e-only `SettingsService.DebugAssignWorkflowHotkey` knob (isolated-data-gated, same shape as `DebugBackdatePendingMCPWrite`) unblocked e2e coverage since real hotkey assignment can't complete headlessly (no native run loop for the OS probe); proven in both `command-palette.spec.ts` and `quick-panel.spec.ts`. Archived.
12. [x] [0022 — Workflow view mode](archive/0022-workflow-view-mode.md) — delivered 2026-08-11 (row click → read-only canvas w/ Run+step-debug; Edit explicit in-place mode switch; breakpoint dot moved onto the node card, both modes; fixed a latent bug where a policy deny could hide a breakpoint's existence)
13. [x] [0036 — View-mode UX hardening](archive/0036-view-mode-ux-hardening.md) — delivered 2026-08-12 (owner-found live UX gaps in goal 0022): table view's Label cell now opens VIEW mode (`WorkflowsTable.tsx`'s Link cell, matching row view's existing click-to-view) — the pencil's straight-to-Edit was the ONLY entry table view had; a "Viewing" mode chip (`CanvasMetaHeader.tsx`, Primer `Label` + `EyeIcon`) makes read-only status legible before touching anything; `NodeInspector`'s disabled `<fieldset>` now renders visibly muted (`opacity`/`cursor` on `:disabled`) — root cause investigated directly against the installed Primer build: `TextInput`/`Select` key their muted visuals off their OWN `disabled` React prop (a `data-disabled` attribute stamped on an internal wrapper `<span>`), never off the native `:disabled` CSS pseudo-class the fieldset cascade already puts on the real `<input>`/`<select>` underneath — fixed at the fieldset-ancestor CSS level (which genuinely matches `:disabled`) rather than threading a prop through NodeInspector's half-dozen nested editors.
14. [x] [0020 — Workflow breakpoints](archive/0020-workflow-breakpoints.md) — delivered 2026-08-11 (ADR-0031 full scope incl. step mode + MCP debug tools; delegated build; found+fixed the ExecuteOptions.WorkflowID never-set bug that silently disabled all workflow/instance-scoped guardrail rules at runtime)
15. [x] [0037 — Seed lifecycle](archive/0037-seed-lifecycle.md) —
    owner-delegated, research-locked design, delivered 2026-08-12:
    `SeedOrigin{SeedRevision, Modified}` provenance on all 30 goldens
    (17 workflows + 13 Configure entities); the old insert-only
    top-up became reconcile (insert/upgrade-in-place/leave-Modified-
    alone/skip-tombstoned), the `Modified` latch set at the write-time
    choke points (`mutateWorkflow`/`UpdateWorkflow`/`UpdateAttributes`;
    each Configure entity's own `Update*`), covering both UI-RPC and
    MCP write paths; reset-to-shipped-example + restore-deleted-example
    RPCs and UI wired into all 6 resource-inventory pages
    (`shared/seedLifecycle.ts`/`shared/RestoreExamplesButton.tsx`,
    reused rather than duplicated 6×); `TestSeedFingerprints_
    MatchCommittedRecord` (`internal/services/seeding`) CI-enforces the
    SeedRevision-bump discipline; `seed-liveness.yml` (goal 0010) now
    opens/updates a labeled tracking issue on failure instead of only
    logging it. Full local suite green (Go build/vet/lint/test, 231
    frontend unit tests, 55-file/177-test e2e suite — the two known
    flaky specs, `canvas-live-sync`/an isolated `guardrail.spec.ts`
    contention flake, both confirmed transient on an isolated rerun).

**Standing — ratified order (owner-delegated prioritization, 2026-08-12: "prioritize all work to line them up"; Dependabot majors pulled to the front same day per the deps-don't-linger policy and are IN FLIGHT as their own sequential wave, not listed here)**
1. [x] E2e CI flake investigation — RESOLVED 2026-08-12 (`fix/e2e-flake-hardening`). Real CI history (last ~30 `ci.yml` runs) showed `canvas-live-sync.spec.ts` failing 6/6 times on shard 1, every single occurrence at the exact same assertion (`canvas-live-sync.spec.ts:151`, the `external-change-banner` count) and every single occurrence co-occurring with a `configure-lists.spec.ts` "list-search node" flake in the SAME run (recovered on Playwright's own retry every time) — zero occurrences before goal 0017 (PR #16) merged, all 6 after. Root cause: goal 0017 gave every direct-mutation Go service its own `dataevent.Emit("workflow", id)` call, so a single MCP `update_workflow` write now fires the SAME `mill-data-changed` event TWICE (`SnapshotDraft`'s own emit via `mutateWorkflow`, plus `UpdateWorkflow`'s own emit) — plus a THIRD echo from the test's own earlier UI-driven `CreateWorkflow`, still possibly in flight when the canvas mounts. None of the three carry payload content, so each independently re-fetches via `CompositionService.Workflows()`; three fetches racing meant whichever RESOLVED last won unconditionally regardless of dispatch order, so a stale response could occasionally win the live-sync decision against a baseline a different, already-applied response had advanced past — wrongly showing the external-change banner on a genuinely clean canvas. A REAL race, confirmed via local reproduction (9/20 clean-canvas repeats failed with zero artificial load, identical assertion/line to all 6 CI failures) and a temporary event-trace instrument. Fixed in `frontend/src/composition/useCanvasLiveSync.ts`: a monotonic per-hook request-sequence ref, bumped at event ARRIVAL time, drops any fetch response that's gone stale by the time it resolves (the standard out-of-order-async-response guard) — correct regardless of how many redundant emits fire in a burst or their resolution order. Verified: 88 consecutive clean local repeats post-fix (0 failures) vs. 9/20 before it, same build. `canvas-live-sync.spec.ts`'s own cleanup (both tests) hardened into an outer try/finally regardless, so a future assertion failure can never again leave an undeleted workflow / unattended-MCP-writes settings behind for later tests in the same worker. `resizable-table.spec.ts` (1 occurrence, PR #24, drag-handle bounding-box) hardened with a condition-based `expect.poll` wait at the point of use, additive to the suite's existing `retries: 1` (goal 0024's documented precedent, untouched). `TestMillMCPService_RealClientRoundTrip` was already fixed (PR #21). Full local suite green; both suspect specs run 5x locally with zero failures.
2. [x] [0039 — Clipboard apply](archive/0039-clipboard-apply.md) — DELIVERED 2026-08-12, owner-driven, slotted in right after the flake fix: "Apply from clipboard…" in the Quick Panel (`app/QuickPanelClipboardApply.tsx`), the enterprise-critical door (MCP is deny-all at a locked-down enterprise environment) — reuses the existing export/import JSON format unchanged (structure-sniffed, workflow only this goal), `exportedWorkflow` gains an optional `id` accepted-on-import (export side still never emits it) driving create-vs-update through the same `SnapshotDraft`+`UpdateWorkflowFromExport` chokepoint `update_workflow` uses, preview-confirm (not park-and-poll — ADR-0032 deliberately doesn't gate this path, the invocation IS the human present), non-blocking dangling-reference + unknown-NodeTypeID surfacing (`composition.RefExists`, the sharing-research import-then-fix verdict). `panel.applyClipboard` command registered (no default binding). Go unit + 4 e2e cases (create/update/malformed/dangling-ref) all green; SPEC.md's "one API, many doors" line added (§3.6).
3. [x] [0031 — AI node family](archive/0031-ai-node-family.md) — DELIVERED 2026-08-12, the flagship capability, shipped as two sequential PRs for reviewability. PR1: `internal/domain/aiprovider` (the `AIProvider` Configure entity, mirrors MCPServer's recipe) + `internal/adapters/aiclient` (`openaicompat` covers Ollama's own `/v1` shim + LM Studio/vLLM/any BYO endpoint, `anthropic` speaks the native Messages API not its OpenAI-compat shim — both httptest-proven) + `process-ai-completion`, plus a pre-flight audit of every registered NodeType's ConfigFields against the Configure-vs-workflow split (verdict: already fully consistent — codified in `.claude/rules/architecture.md`). PR2: `process-ai-extract-structured` (own typed output-field editor, `AIExtractFieldsEditor.tsx`) + `process-ai-classify` (node-local category list, fail-safe on an out-of-enum response) + the "Example: AI classify -> branch" seed — THE decisioning composition (AI writes a category Attribute, Branch routes on it). Effect: static `ClassExternal` on all three, `EffectForNode` downgrades to `ClassLocal` for a loopback AIProvider BaseURL (owner-ratified 2026-08-12: "you're the boss") — remote asks by default, local Ollama frictionless. Conforms to node-standard.md from birth; `docs/SPEC.md` §3.3 flipped OPEN → LOCKED.
4. [x] Copy-management migration ×4 (`app/` → `composition/` → `configure/` → `views/`) then the `eslint-plugin-i18next` revisit — DELIVERED 2026-08-12, see item 10's own writeup above ([0032](archive/0032-copy-management.md)).
5. [x] Workflow pins/favorites (tech debt, split from goal 0015's remainder 2026-08-12) — DELIVERED 2026-08-13: `pinnedWorkflowIds: string[]` + `togglePinnedWorkflow` on `shared/store.ts`'s existing zustand `persist` (same localStorage tier as `activeWorkTabKey`, goal 0033's precedent — no new Go surface). `app/workflowFrecency.ts`'s new `sortWorkflowsByPinnedAndFrecency` partitions pinned (in pin-order) above the existing frecency-sorted unpinned tail, reusing `sortWorkflowsByFrecency` rather than a second algorithm. A Primer `PinIcon` `IconButton` trailing-visual pin toggle on both the Quick Panel's and ⌘K palette's workflow rows (muted outline unpinned, accent-colored "filled" once pinned) — found and fixed a real Primer interaction bug along the way: `ActionList.Item`'s own `TrailingVisual` wraps children in a `VisualWrap` span with `pointer-events: none` (trailing visuals are decorative-only by the library's own convention), which silently ate every click on the toggle until `pointer-events: auto` was added back on the button itself. Vitest covers the pinned-above-frecency/pin-order/unpinned-id-dropped/no-mutation cases; `quick-panel.spec.ts` gained a full pin→sort→unpin→revert→reload-persists e2e case.
6. [x] ⌘?/⌘/ multi-binding keybinding alias (tech debt, split from goal 0015's remainder 2026-08-12) — DELIVERED 2026-08-13: `Command` grew an optional `extraBindings: KeyCombo[]` alongside `defaultBinding` (`shared/commands.ts`, backward-compatible); `shared/keybinding.ts`'s `keyFromEventCode` gained `/` support (shift-independent, same as every other key — the Shift mod is what distinguishes ⌘/ from ⌘?, both on the physical Slash key). `palette.open` carries both as `extraBindings`, checked against the full registry + `RESERVED_COMBOS` first (no collision — nothing else uses `/`). `dispatchCommandForEvent` checks a command's effective (override-aware) primary plus its extras every dispatch; extras themselves are deliberately NOT override-checked this pass (Settings' recorder-based rebinding UI still edits only the primary). `views/KeyboardShortcutsSection.tsx` renders extras as read-only secondary `KeyComboChip`s next to the primary's click-to-rebind button. Vitest covers dispatch-matches-either-binding + override-doesn't-disable-extras + no-extraBindings-backward-compat; `keymap.spec.ts` gained both a live ⌘//⌘⇧+/ → palette-opens case and a Settings-renders-the-two-read-only-chips case.
7. [ ] [0021 — MCP dogfood gap closure](0021-mcp-dogfood-gap-closure.md) Phase 2 (orchestrator-driven live MCP probing) + Phase 3 (that probe's gap closure) DELIVERED 2026-08-13: the live author-from-scratch + full `run_workflow_stepped` probe found the loop mechanics themselves sound, plus two interop gaps — inconsistent identifier argument names across tools (`id` vs. `runId` vs. `workflowId`) and `run_workflow` always landing `test` kind with no way to opt out (silently excluding real agent-triggered production runs from Home's metrics). Both fixed same day: every workflow-identifying tool now accepts a canonical `workflowId` alongside its original `id` (one shared `resolve()` helper, backward compatible); `run_workflow` gained an optional `test` boolean (default `false` → new `RunKindMCP`, counted in Home's automation metrics like a real trigger fire; `test:true` → `RunKindTest`, excluded, matching the UI's Test button) — `run_workflow_stepped` stays unconditionally `test` kind (debug surface). Real-MCP-client Go tests prove both. Left UNCHECKED / not archived: the goal file's own separate Phase 4 (Confluence-markdown-fidelity fixture corpus + M365 bridge dry run) remains genuinely open, substantial, unaddressed work outside this round's scope — the file's own acceptance bar is the owner calling the whole surface real-use-ready, not one phase closing.
8. [x] Dev-loop instance guards (tech debt, owner-hit 2026-08-12 evening: THREE concurrent `mill.dev.app` instances in the dock, real crash risk on the 16GB machine) — DELIVERED 2026-08-13, both mechanical fixes landed: (a) per-rebuild reap — `build/config.yml`'s `dev_mode.executes` gained a `type: blocking` `pkill -f "bin/mill.dev.app/Contents/MacOS/mill" || true` step right before the `primary` `wails3 task run` step (blocking steps re-run every reload cycle, confirmed directly against the vendored `github.com/atterpac/refresh` engine source — its own `Primary` case already SHOULD kill-then-restart via a process-group SIGKILL, but a live `task dev` session running during this item's own investigation was caught red-handed with two concurrent `mill.dev.app` processes, one orphaned into a foreign process group refresh's own tracking never reaped; root cause not fully pinned to one line since it's in a vendored third-party dependency, so this reap is an independent, pattern-based backstop rather than a patch to code this repo doesn't own — same shape Taskfile.yml's own start-of-session sweep already used); (b) `task dev` now refuses a second concurrent start — `internal/devguard` (a real Go package, `package main`, unit-tested: `guard_test.go` covers process-list parsing, the wails3-dev-process matcher incl. a real false-positive it caught and fixed against a differently-pathed sibling project, port-PID parsing, and message formatting) runs as the FIRST step of `Taskfile.yml`'s `dev:` task, checks for an already-running `wails3 dev` process for this exact repo, and exits non-zero naming the conflicting PID (+ any port occupancy as corroborating detail) before the destructive sweep steps can run — verified live against a genuinely running session (correctly detected + refused, naming the real PID). Manual-only registry entry added (`.claude/skills/run-mill/SKILL.md`) for what CI structurally can't prove: real per-rebuild-orphan-prevention across several live Go-triggered rebuilds, and a genuine second-terminal `task dev` invocation actually refusing to start.
9. [x] Dock-bounce on parked approvals — DELIVERED 2026-08-13 exactly
   as scoped: `dockBounceFn` seam + one call site in
   `NotifyPendingApproval`'s away branch (`window.Flash` →
   NSInformationalRequest, bounces once and self-completes — never
   repeating/critical), same kernel attention-layer class as the dock
   badge (ADR-0035); nil-window guard unit-tested, the full away
   branch isn't headless-testable (notify's cgo send aborts under
   `go test` — discovered here, recorded in testing.md's manual-only
   note along with the desktop-mode verification step); SPEC §3.6's
   attention-layer paragraph updated.
10. [x] resizable-table.spec.ts drag-timing flake, PROPER fix (3 confirmed recurrences POST-hardening: PR #24 original, #43's run, #44's run — the expect.poll hardening from PR #33's wave was insufficient) — DELIVERED 2026-08-13. A keyboard-based resize alternative was checked and ruled out (`shared/ResizableTable.tsx`'s drag handle is built entirely on pointerdown/pointermove/pointerup, no keyboard path at all — building one would be a real feature addition, not a test fix). Landed instead: `test.describe.configure({ mode: 'serial' })` makes the file's own never-interleave requirement explicit rather than an incidental side effect of global config; `waitForStableBoundingBox` replaces the old non-null-only `expect.poll` with a poll for the box being IDENTICAL across two consecutive reads (a non-null box mid-reflow was always possible the old check couldn't see); the synthesized drag itself moved from one batched `page.mouse.move(..., { steps: N })` call to discrete, individually-awaited moves (a browser can coalesce rapid pointermove events within one CDP command — a real, documented behavior via the `PointerEvent.getCoalescedEvents()` API, not Playwright-specific); and two more `expect.poll`s wait for the drag's actual DOM effect and the `localStorage` persist to land before the next step depends on them, instead of assuming the previous Playwright command's own resolution implies the page's JS listener already ran. Verified via 5 separate fresh `npx playwright test` invocations (10/10 passed) — an in-process `--repeat-each` stress loop on the same worker turned out to be a self-confounding methodology (accumulating browser/worker degradation unrelated to the fix, not representative of a real CI run) once cross-checked against genuinely fresh runs.
11. [x] 0030 second-pass linters (gocritic/prealloc/contextcheck/sqlclosecheck — named future work in goal 0028) + `.ls-lint.yml` gains a root `node_modules` ignore (gap found 2026-08-12: a stray root node_modules broke root-file-naming; tiny, rides this or any PR) — DELIVERED 2026-08-13. All four enabled in `.golangci.yml`; triaged to zero findings on both build-tag variants (default + `server`) — 14 real findings fixed (1 `gocritic` assignOp in a test file, 13 `prealloc` slice-capacity hints across `seedproof_test.go` and `millmcpservice.go`'s resource-index readers), zero `contextcheck`/`sqlclosecheck` findings, zero rules needed a scoped tweak or a `//nolint` suppression this pass. `.ls-lint.yml`'s root `ignore:` list gained `node_modules` with a comment explaining the root-scoped-recursive-rule interaction.

**Owner-needed lane (parallel, never blocks the queue)**
- [ ] [0001 — Authoring-surface overhaul](0001-authoring-surface-overhaul.md) (spacing audit + §3.8 prototype elements — live-review material, needs the owner driving; design wave 1 DELIVERED 2026-08-12 — 7 app-wide convention/bug fixes from a full-app audit screenshot pass, zero taste calls; design wave 2 DELIVERED 2026-08-13 — identity tokens: Mill's own accent scale layered over Primer, node-kind canvas colors decoupled from status semantics, one StatusStamp component replacing 7 pill families, a shared mono-font utility; design wave 3 DELIVERED 2026-08-13 — palette IA: 6 domain Kinds regrouped into 9 frontend display groups, label-shortening bug fixed, palette search added, Configure > Attributes conforms to its sibling tabs, Configure row-action icon-button consistency; both design-wave PRs now shipped, goal stays open pending the owner's live sign-off)
- [ ] Owner hands-on pass over the week's shipped features (Quick Panel focus fix, view-mode hardening, inline hotkey hints, seed reset/restore)

**Delivered**
- [x] [0003 — MCP authoring live dogfood](archive/0003-mcp-authoring-dogfood.md) — 2026-08-10
- [x] [0006 — Trigger-aware Workflows list](0006-trigger-aware-workflows-list.md) — 2026-08-10
- [x] [0007 — Resource-inventory redesign](0007-resource-inventory-redesign.md) — 2026-08-10 (owner recognition test passed live: "like an addition")
12. [x] [0016 — Keymap system](archive/0016-keymap-system.md) — delivered 2026-08-10 (command registry, Settings rebinding, ⌘W→tab, Run=⌘↩; 127/127)
- [x] [0017 — Real-time surfaces audit](archive/0017-realtime-surfaces-audit.md) — delivered 2026-08-12 (root cause: only mcpsvc emitted mill-data-changed; gave CompositionService/ConfigureService/GuardrailService their own dataevent.Emit, fixed App.tsx's list/mcpserver misrouting, added a lists/decisions/mcpServers/execEnvs shared store, wired run/workflow/guardrail-rule subscribers across WorkflowRunsPanel/Home/ActivityRunsExplorer/CompositionView/useGuardrailBadges/ReviewView)
