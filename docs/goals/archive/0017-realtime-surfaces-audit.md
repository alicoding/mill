# 0017 — Real-time surfaces audit: never make the user refresh

## Goal
Owner-stated product value (2026-08-10): "everything should be
real-time — the user should never have to come in or reopen anything."
SPEC §1 now locks it. This goal is the AUDIT + fixes: find every
surface that can show stale state requiring a manual refresh/reopen,
and close each gap via the existing event layer (no new mechanism —
§0005's unified eventing is the substrate).

## Audit targets (enumerate, then fix)
Read every view/panel and ask "if X changes elsewhere, does this
update live, or only on remount/refetch/reopen?":
- Workflows/Configure inventories (do they refresh on mill-data-changed
  when an entity is created/edited/deleted — incl. via MCP author?)
- A workflow's Runs tab (updates as a run progresses/completes without
  reopening the tab?)
- Activity feed (already event-pushed — confirm complete)
- Review queue (currently a 2s poll — is that "real-time enough", or
  should it consume guardrail-pending-changed and drop the poll?)
- Version badges / lifecycle state on list rows (update when Publish
  happens in another tab?)
- The value-mirror/Home stats (goal 0014) when it lands — live counts
- Cross-tab: edit an entity in one work tab, does a picker referencing
  it in another tab see the change?
- The build-staleness badge (§3.8) — already the "am I current" signal

## Approach
1. Systematic audit (an explorer/read pass) producing the stale-gap
   list with file:line per surface.
2. Fix each via mill-data-changed / guardrail-pending-changed
   subscriptions (the pattern App.tsx + MCPWriteApprovals already use)
   — never a new bus, never polling where an event exists.
3. Where a poll is genuinely the honest choice (an external resource
   Mill can't get an event for), document why.

## Audit findings (2026-08-10) — ROOT CAUSE + fix-list
**Root cause (one sentence): only the MCP layer emits
`mill-data-changed`; direct UI mutations through the Wails services
never do.** That's why the MCP-authoring dogfood felt live (it emits)
while a plain UI create/edit doesn't reach other tabs/pickers.

**The fix is uniform, not per-surface**: emit `mill-data-changed
{Entity, ID}` (the existing `application.Get()` pattern from
millmcpservice_authoring.go) from the DIRECT-mutation services:
- `CompositionService`: after Create/Update/Delete/**Publish**Workflow
  + UpdateWorkflowAttributes (entity:'workflow') — Publish-badge-stale
  is a P0.
- `ConfigureService`: after each entity's CRUD (entity:'request'/
  'list'/'mcpserver') — fixes the Configure inventories AND the canvas
  entity pickers not seeing new entities (the other P0).
- `GuardrailService`: after rule CRUD (entity:'guardrail-rule') — so
  canvas guardrail badges reflect external rule changes.
Then the ❌ surfaces subscribe (most via App.tsx's existing
mill-data-changed handler → store refresh; the canvas badge re-runs
WorkflowVerdicts on entity:'guardrail-rule').

**Polls — verdicts:**
- Review queue's 2s poll → subscribe to guardrail-pending-changed
  (the event now exists), keep poll as fallback. ⚠️→✅.
- Runs-tab + canvas live-run 1s polls → **KEEP, documented**: DBOS
  emits no per-step event, so polling an in-flight run is the honest
  only-path (the real-time value's "poll justified in writing" clause).
**Already ✅** (no work): Activity feed, the Review pending badge,
MCP-write approvals, build-staleness badge.

## Acceptance
The owner can: create/edit/delete an entity in one place and see it
everywhere live; watch a run complete on its Runs tab without
reopening; have an MCP author change something and see it in the open
window — with no manual refresh anywhere, and any remaining poll
justified in writing.

## Delivered 2026-08-12

All P0/P1/P2 items from the audit's fix list, implemented:

- **P0-1** `CompositionService` now emits `mill-data-changed
  {entity:"workflow"}` after Create/Update/Delete/UpdateAttributes
  (compositionservice.go) and, via the shared `mutateWorkflow` choke
  point, Publish/PublishExistingVersion/RestoreVersionToDraft/
  SetWorkflowDisabled/SnapshotDraft (compositionservice_versioning.go)
  — `ImportWorkflow` inherits it for free (delegates to CreateWorkflow).
- **P0-2** `ConfigureService` now emits for request/list/mcpserver/
  decision (new)/execenv (new) CRUD, including List row mutations
  (AddListRow/UpdateListRow/DeleteListRow) — `UpdateWorkflowAttributes`
  inherits `workflow`'s emit via its delegation to
  `CompositionService.UpdateAttributes`. Lists CRUD split out of
  configureservice.go into configurelist.go (500-line limit).
- **P0-3** `GuardrailService` emits a new `guardrail-rule` entity after
  rule CRUD.
- **P0-4** App.tsx's `mill-data-changed` handler no longer misroutes
  `list`/`mcpserver` to `refreshRequests()`+`refreshWorkflows()` — each
  entity now routes to its own store's refresher.
- **Shared emit helper**: `internal/services/dataevent` (new package)
  is the ONE place `EventName`/`Changed`/`Emit` are defined — mcpsvc's
  old locally-owned `DataChanged`/`DataChangedEventName`/
  `emitDataChanged` were migrated onto it, removing the duplication the
  audit's root cause created.
- **P1-1** `frontend/src/shared/configureEntityStore.ts` (new file,
  mirrors store.ts's workflows/requests pattern) backs
  ConfigureLists/ConfigureDecisions/ConfigureMCPServers/ConfigureExecEnv
  — each switched from its own local `useState` + fetch to the shared
  store. ConfigureAttributes switched to store.ts's existing shared
  `workflows`.
- **P1-2/P1-3/P1-4** WorkflowRunsPanel, HomeView (covers HomeMostUsed),
  and ActivityRunsExplorer each subscribe to
  `mill-data-changed{entity:"run"}` and refresh their run list/metrics.
- **P2** CompositionView's `refreshArmed`, `useGuardrailBadges`, and
  ReviewView (added a `guardrail-pending-changed` subscription
  alongside its existing 2s poll, kept as the documented fallback) all
  wired.
- **Proofs**: Go unit tests per service
  (`*_dataevent_test.go` in compositionsvc/configuresvc/guardrailsvc,
  using `dataevent.TestHook` — the seam added since `application.Get()`
  is always nil under `go test`); a new e2e spec,
  `e2e/realtime-cross-surface.spec.ts`, proves the flagship two-surface
  scenario both ways (an MCP-authored `import_list` reaching an open
  Configure > Lists tab; a direct-UI workflow create in one browser
  window reaching a canvas picker open in a second window) — neither
  page ever reloads.
- **Left as-is, per the audit's own verdict** (unchanged): the in-flight
  run 1s polls (DBOS has no per-step event), QuickPanel's
  refresh-on-summon, hover-preview/EntityRefField mount-fetches.
