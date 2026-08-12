# 0025 — Substance hardening: fix the audited green-but-wrong class

## Goal
Close the ranked findings from the two 2026-08-11 quality sweeps
(owner-mandated: "the pipeline is good but the code is shiat" fear),
so green means what it claims — with the classes locked in, not just
the instances patched.

## Plan
Go wave (the concentrated debt — full findings in the audit report,
key ones restated for standalone execution):
1. [x] All 12 `_ = store.Set(...)` persistence sites: propagate the
   error through the mutation RPC (the caller learns a write failed;
   log-only where genuinely fire-and-forget, e.g. window geometry).
   The 12-site list is in the audit; triggersvc:150 is the existing
   correct pattern.
2. [x] `servicetest.FakeStore` gains failure injection; representative
   persist-failure tests per service package (the class was
   structurally untestable before).
3. [x] `guardrailsvc.WorkflowVerdicts` (canvas safety-badge data
   source, §8's "nothing hidden") + `UpdateRule`: real tests, zero →
   covered.
4. [x] `millmcpservice_authoring.go` diff-preview: malformed external
   JSON must show "(unable to parse proposed definition)" to the
   approver, never fabricated `N→0` numbers.
5. [x] `AssignHotkey` TOCTOU: re-verify conflict after re-acquiring
   the lock before the persisted write.
6. [x] `notify` response-callback's swallowed ResolveMCPWrite + the
   dockbadge/notify adapters' missing manual-only registry entries.

Frontend wave (audit came back largely clean; remainder):
7. [x] MCPWriteApprovals swallowed approve/deny errors + App.tsx
   'time' listener leak (fixed 2026-08-11, in tree).
8. [x] Vitest for `canvasScratch.normalize/draftsEqual` (hot-exit
   dirty-detection — data-loss-adjacent pure logic) and
   `requestDraft.authConfigFrom/joseConfigFrom`.
9. [x] LOW items (delivered 2026-08-11): `WorkflowHoverPreview.tsx`'s
   `scheduleOpen` timeout now clears on unmount (a real `useEffect`
   cleanup, alongside the existing mouseleave-triggered `cancelOpen`);
   `PageContainer.tsx`'s `PageContainerVariant` type is no longer
   exported (verified zero references outside the file first — it was
   dead public surface, kept as an internal type alias);
   `authoring-validation.spec.ts`'s `deleteStarterNode` now uses the
   same candidate-point/`elementFromPoint` verification the sibling
   specs (`composition-canvas-interactions.spec.ts`,
   `child-workflow.spec.ts`) already use for canvas-node clicks,
   rather than a plain `.click()` that could land on React Flow's own
   Controls/MiniMap chrome — this file's own local copy, per the
   suite's per-file-helper convention.

## Acceptance
Every accepted finding fixed with its committed repro (a persist
failure surfaces to the UI in a test; WorkflowVerdicts has real cases);
`go test -race` + full suites green; the audit's HIGH list re-checked
empty.
