# 0025 — Substance hardening: fix the audited green-but-wrong class

## Goal
Close the ranked findings from the two 2026-08-11 quality sweeps
(owner-mandated: "the pipeline is good but the code is shiat" fear),
so green means what it claims — with the classes locked in, not just
the instances patched.

## Plan
Go wave (the concentrated debt — full findings in the audit report,
key ones restated for standalone execution):
1. [ ] All 12 `_ = store.Set(...)` persistence sites: propagate the
   error through the mutation RPC (the caller learns a write failed;
   log-only where genuinely fire-and-forget, e.g. window geometry).
   The 12-site list is in the audit; triggersvc:150 is the existing
   correct pattern.
2. [ ] `servicetest.FakeStore` gains failure injection; representative
   persist-failure tests per service package (the class was
   structurally untestable before).
3. [ ] `guardrailsvc.WorkflowVerdicts` (canvas safety-badge data
   source, §8's "nothing hidden") + `UpdateRule`: real tests, zero →
   covered.
4. [ ] `millmcpservice_authoring.go` diff-preview: malformed external
   JSON must show "(unable to parse proposed definition)" to the
   approver, never fabricated `N→0` numbers.
5. [ ] `AssignHotkey` TOCTOU: re-verify conflict after re-acquiring
   the lock before the persisted write.
6. [ ] `notify` response-callback's swallowed ResolveMCPWrite + the
   dockbadge/notify adapters' missing manual-only registry entries.

Frontend wave (audit came back largely clean; remainder):
7. [x] MCPWriteApprovals swallowed approve/deny errors + App.tsx
   'time' listener leak (fixed 2026-08-11, in tree).
8. [ ] Vitest for `canvasScratch.normalize/draftsEqual` (hot-exit
   dirty-detection — data-loss-adjacent pure logic) and
   `requestDraft.authConfigFrom/joseConfigFrom`.
9. [ ] LOW items: WorkflowHoverPreview unmount timer, unused
   PageContainerVariant export, authoring-validation.spec's unhardened
   canvas click.

## Acceptance
Every accepted finding fixed with its committed repro (a persist
failure surfaces to the UI in a test; WorkflowVerdicts has real cases);
`go test -race` + full suites green; the audit's HIGH list re-checked
empty.
