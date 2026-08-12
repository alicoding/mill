# 0002 — Review queue maturation

## Goal
The Review queue works as the case-management-style inbox from
`docs/SPEC.md` §3.2/§8 (ADR-0023) for real daily use — without
crossing the no-Camunda line (no assignment/SLA/notes).

## Plan
1. [x] Workflow filter over pending + resolved (delivered 2026-08-10).
2. [x] Recently-resolved visibility — RunSummary.Resolution read from
   the same park event after resolution; Review shows the last 10
   with approved/denied/timed-out labels (delivered 2026-08-10,
   e2e-covered: deny → resolved section → filter).
3. [x] Pending-count sidebar badge — delivered alongside 0005's unified
   event, same build as planned (`guardrail-pending-changed`, consumed
   in `AppSidebar.tsx` via `review-pending-count`, summed with the
   mcp-write-approval channel, no polling); e2e-covered
   (`guardrail.spec.ts`'s "Sidebar Review badge..." test). Checkbox was
   stale — found already-built while working item 4, corrected here
   rather than left inaccurate.
4. [x] Kind filter + empty/loading polish (delivered 2026-08-11):
   `ReviewView.tsx` gained a "Filter by kind" Select (policy ask /
   human review checkpoint / debug park / MCP write request,
   discriminated off `pending.source`/`pending.nodeTypeID` plus the
   separate pendingWrites list), shown only when 2+ kinds are
   present (SPEC §3.5's single-option-select-is-noise rule); a
   Human review checkpoint also got its own leading icon
   (`PersonIcon`, distinct from the ambient-ask `ShieldIcon`) since
   filtering it as a separate kind needed a real recognition cue, not
   just a new Select bucket. Empty state is now the shared Primer
   `Blankslate` (`InboxIcon` + one heading line, same pattern as
   `HomeView.tsx`/`InventoryList.tsx`); loading (`pending === null`)
   now shows `HomeView.tsx`'s own centered-`Spinner`-under-the-Heading
   treatment instead of rendering nothing. E2e-covered end-to-end
   (`guardrail.spec.ts`): all three kinds parked at once (a policy
   ask, a human-review checkpoint, and a real MCP write request over
   a live MCP client), the Select narrows to each, and the Blankslate
   shows once every kind clears back to zero. The MCP-client test
   helpers (`connectMCPClient`/`findWorkflowIdByLabel`/
   `exportWorkflowViaMCP`/`enableMCPWritesWithApprovalRequired`/
   `restoreMCPWriteDefaults`) were promoted out of
   `mcp-write-approval.spec.ts` into a shared `e2e/mcpTestClient.ts`
   module so this new test didn't hand-roll a second copy.
5. [x] Row drill-down (delivered 2026-08-10): every Review row opens
   its run in the work-tab shell at the workflow's Runs tab, run
   detail preselected (consumed-once `pendingRunFocus` store seam);
   Approve/Deny stopPropagation-protected; e2e ×3. The "1-12-31"
   timestamp root cause was deeper than display: DBOS only writes
   StartedAt on queue-dequeue, which Mill never uses — EVERY run had a
   zero start; `summaryFromStatus` now falls back to CreatedAt
   (regression-tested), fixing Review, Runs, Activity, and MCP
   `get_run`/`list_runs` responses all at once.
6. [ ] The fuller case-management growth path (durable Case entity,
   Statuses/Queues/Checklists/Automations, the MCP-written AI summary)
   is recorded as design input in SPEC §3.2.1 — future research, not
   this goal's scope.

This goal's Acceptance is now fully met (items 1-5 delivered; item 6
is recorded future design input, not build scope) — left for the
completing commit to archive per CLAUDE.md's own convention.

## Acceptance
Run the seeded review example plus a guardrail ask; both flows are
filterable, resolutions are visible after the fact, and the sidebar
shows pending count — judged live by the owner.
