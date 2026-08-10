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
3. [ ] Pending-count signal on the sidebar Review entry — needs an
   app-level poll or a Go→JS event on park/resolve; the event is the
   right shape (emit alongside SetEvent in parkForApproval), decide
   there rather than polling. (Goal 0005 flags this same event as
   plausibly shared with the pending-attention model — check there
   before building it twice.)
4. [ ] Kind filter + empty/loading polish per the overhaul's spacing
   standards.
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

## Acceptance
Run the seeded review example plus a guardrail ask; both flows are
filterable, resolutions are visible after the fact, and the sidebar
shows pending count — judged live by the owner.
