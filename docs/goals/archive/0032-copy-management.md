# 0032 — Copy management: is Mill's UI text hardcoded, and what fixes it

## Goal
Owner-observed 2026-08-12: every string in Mill's UI is likely
hand-typed inline JSX. Confirmed by audit: 40 of 72 `.tsx` files carry
inline copy, zero i18n library in `frontend/package.json`, no
locale/copy directory anywhere. Owner's explicit constraint: adopt an
existing lightweight, **no-server** solution — "so we don't rebuild
that locally," per `.claude/rules/architecture.md`'s adopt-over-
hand-roll default and SPEC §1.1's no-hosted-service-dependency hard
constraint.

**Reframed by the owner mid-research (2026-08-12): this is plain i18n,
not a CMS.** "Authoring a json for [copy] locally is fine just as long
as we don't hardcode text and key to value etc which is i18n" —
confirms the research instinct that "headless CMS" was the wrong frame
for a desktop app's inline copy. The actual want: key→value JSON files
+ an i18n library, no CMS product, no authoring UI layer. Locks the
research's localization-vs-centralization question in favor of
straight i18n tooling (react-i18next/react-intl-class options) — the
CMS candidates (Decap/Sveltia/Keystatic/Tina) are answering a website
question Mill doesn't have.

## Plan
1. [x] Research DONE 2026-08-12 (all sources primary, GitHub/npm/docs
   verified live). Verdict: "headless CMS" is the wrong frame — every
   git-native CMS candidate (Decap, Sveltia, Keystatic, Tina) requires
   either a hosted OAuth intermediary or a locally-running backend
   daemon, disqualified by SPEC §1.1's no-hosted-service/no-second-
   daemon constraint regardless of maintenance health (all four are
   healthy — rejected on architecture fit, not quality). This is
   copy-centralization, not localization, solved by a plain i18n
   library. **Adopt: react-i18next v17.0.11 + i18next v26.3.6 (both
   MIT, actively maintained, zero server)**, namespace-per-view JSON
   (i18next's own documented convention) mirroring Mill's existing
   frontend/src/{app,composition,configure,shared,views} structure.
   Rejected explicitly, not to be re-proposed: Decap/Sveltia CMS (OAuth
   intermediary or decap-server daemon required), Keystatic
   (Next.js/Astro/Remix only, no plain-Vite path), TinaCMS (self-hosted
   path needs its own GraphQL backend + DB adapter — "Local Mode"
   doesn't remove this).
2. [x] Capability map DONE 2026-08-12: today's need is English-only
   copy centralization (no language switcher, no plan for one yet);
   the realistic future is (a) actual localization if Mill ever ships
   non-English UI and (b) faster live-copy iteration without touching
   JSX. Schema decided once: namespace-per-bounded-context JSON
   (`frontend/src/locales/en/{common,app,composition,configure,
   views}.json`, mirroring `frontend/src`'s own folders), nested
   per-view keys inside each namespace (e.g. `views.json`'s
   `settings.*`) rather than one file per component — i18next's own
   documented convention, and it keeps the file count bounded (5
   files, not 72) while still scoping per bounded context if ever
   needed later.
3. [x] Migration scope estimate DONE 2026-08-12: staged, not one PR —
   this pass ships the library + init + ONE real slice (Settings) as
   proof; the remaining ~39 files are tracked as four Standing
   tech-debt entries in `docs/goals/BACKLOG.md` (`app/`, `composition/`,
   `configure/`, `views/` minus Settings), each with its own DoR/DoD
   per `.claude/rules/delivery-discipline.md` — never a bare TODO.
4. [x] Build DONE 2026-08-12 (partial, by design): `react-i18next`
   v17.0.11 + `i18next` v26.3.6 installed; `frontend/src/app/i18n.ts`
   (init, wired into `main.tsx`); `SettingsView.tsx` fully migrated
   (`views.json`'s `settings` namespace + `common.json`'s shared action
   verbs) as the proof-of-pattern slice, verified against the existing
   `e2e/settings.spec.ts` (unchanged assertions still pass — translated
   text matches the original English exactly) plus a new
   `app/i18n.test.ts` unit test (init loads, `t()` resolves a known key,
   interpolation works). `eslint-plugin-i18next` evaluated as a guard
   against new hardcoded strings — deliberately NOT added yet: its
   `no-literal-string` rule would fail the lint gate across the ~39
   still-unmigrated files rather than just guarding new code; revisit
   once the Standing tech-debt entries close the gap.

## Acceptance
A capability map and adopt-vs-build decision recorded in SPEC (done —
`docs/SPEC.md`'s copy-management bullet, §1.3); the chosen pattern
lands with a working example, not just a library install (done —
Settings, proven live + by test); remaining hardcoded copy is tracked,
not silently orphaned (done — four Standing tech-debt entries in
`docs/goals/BACKLOG.md`, each independently DoR/DoD-shaped, all four
now delivered); a regression guard exists so newly-written code can't
silently reintroduce hardcoded copy (done — `eslint-plugin-i18next`).

**Status: DELIVERED 2026-08-12, fully migrated + guarded.** The four
Standing tech-debt entries closed as five sequential PRs off this
goal's own `SettingsView.tsx` proof-of-pattern slice:

5. [x] `app/` slice — every `app/*.tsx`/`.ts` file (App.tsx's shell
   chrome, QuickPanel/QuickPanelClipboardApply, ApprovalPrompt,
   AppSidebar, BuildIdentityBadge, CommandPalette, MCPWriteApprovals,
   WorkTabShell, pageMeta.tsx, workTabLabel.ts) migrated into
   `app.json`, `common.json` gained shared action verbs
   (approve/deny). Two latent `t`-variable-name shadowing bugs (a
   `setTimeout` handle and a `.find()` loop param each named `t`,
   which would have collided with the new translation hook) caught
   and fixed along the way.
6. [x] `composition/` slice — split into three sub-PRs at judgment
   once started (the folder is ~6600 non-test lines across ~28
   files, too large for one reviewable PR): **panels**
   (WorkflowRunsPanel, LiveRunControls, WorkflowVersionsPanel,
   WorkflowsTable, WorkflowHoverPreview), **canvas**
   (CompositionView, CompositionCanvas, CanvasNodeView, CanvasToolbar,
   CanvasMetaHeader, NodePalette, ExternalChangeBanner,
   WorkflowEditorTab, TestRunDialog, ValidationPanel, plus
   `draftWorkflowSchema.ts`'s zod validation messages and
   `hotkeyCapture.ts`'s two recorder errors — both pure-function
   modules that take a `t` translate function as an explicit argument
   since their copy is baked in at module-load/call time, not render
   time), **inspector** (NodeInspector, NodeExecutionSection,
   NodeGuardrailSection, TriggerRowLabel, every node-type-specific
   binding/args editor, `validationCopy.ts`'s clipboard-export
   formatter following the same `t`-as-argument shape). Truly-shared
   short vocabulary (armed/not live/Publishing…/Step/Continue/Resume/
   Deny/Stop/paused-state phrasing/Apply built condition) promoted to
   `composition.json`'s top level since it recurs verbatim across
   these surfaces. The same `t`-shadowing bug class caught three more
   times (`MCPToolArgsEditor.tsx` twice, `ConfigureDecisions.tsx`
   once during the `configure/` slice below).
7. [x] `configure/` slice — the entire bounded context in one PR: the
   seven Configure tabs (Integration, Lists, Attributes, MCP Servers,
   Decisions, Execution Environments, AI Providers) plus the full
   Integration create/edit/test form (RequestForm,
   RequestAuthSections, RequestSummary, RequestTestPanel,
   SchemaIntake, ManualSchemaEditor, EntityRefField's cross-Configure
   quick-create dialog). `openapiSynth.ts`'s
   `parseCSVToOperations`/`parseOpenAPIToOperations` and
   `pasteSample.ts`'s `inferFieldsFromSample` gained the same
   `t`-as-first-argument shape as `draftWorkflowSchema.ts`;
   `authTypeLabels.ts`'s `AUTH_LABEL` map became `authLabelFor(t)`,
   `decisionCategoryLabelFor` exported from `EntityRefField.tsx` and
   reused by `ConfigureDecisions.tsx` rather than a second copy of the
   same Category→label mapping.
8. [x] `views/` minus Settings slice — Home (HomeView, HomeChart,
   HomeMostUsed, `homeFormat.ts`'s `formatMinutes` gaining the same
   `t`-as-argument shape), Activity (ActivityView,
   ActivityRunsExplorer), Review (ReviewView), PlaceholderView, and
   `KeyboardShortcutsSection.tsx` (a `SettingsView.tsx` dependency the
   original proof-of-pattern slice had missed, caught and closed here).

Then the deferred `eslint-plugin-i18next` revisit, ridden on the
`views/` PR: checked empirically against the fully-migrated codebase
before enabling anything — `jsx-only` mode (which also validates JSX
attribute values, not just text children) produced ~290 warnings
dominated by Primer/DataTable prop names (`stackId`, `dataKey`,
`weight`, `testId`, `entity`, …) sitting on custom (non-native-DOM)
JSX elements nested inside object-literal props, not real copy —
taming that would need a large, brittle Primer-specific attribute
allowlist for a marginal catch. `jsx-text-only` mode (the plugin's own
default — JSX text children only) gave a small, accurate signal
instead: five genuine leftovers, all outside this migration's
four-slice scope since they live in `shared/` (never one of the named
bounded-context page folders) — `InventoryList.tsx` (search
placeholder/aria-label/no-matches text, an "Actions for X" aria-label),
`LiteralOrAttributeField.tsx` (required badge, literal/attribute
picker copy), `RestoreExamplesButton.tsx` ("Restore example…") — plus
two in already-migrated files (`WorkflowVersionsPanel.tsx`'s `v{n}`
prefix, `RequestTestPanel.tsx`'s `{ms}ms` suffix) the mode's stricter
direct-JSX-text-child check caught that the manual pass had missed.
All five fixed in the same change that turned the rule on, added to
`common.json` (the cross-cutting namespace already established for
shared action verbs). Rule now wired into `frontend/eslint.config.js`,
scoped to `src/**/*.{ts,tsx}` (test files excluded), `error` severity
— a real gate, not an ignored warning.
