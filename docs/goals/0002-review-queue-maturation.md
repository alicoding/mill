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
5. [ ] Row drill-down (owner-raised 2026-08-10: "clicking does
   nothing"): every Review row — pending or resolved — opens its run
   in the app-wide work-tab shell at the workflow's Runs tab with that
   run preselected (the reference platform's own "same shell for case
   inspection, run inspection, approval handling" pattern, SPEC
   §3.2.1; ONE run-detail viewer per §7's lock). Pending rows keep
   inline Approve/Deny as the primary action. Includes fixing the
   zero-time timestamp on resolved rows ("1-12-31" — an unset
   startedAt formatted instead of falling back to resolution time).
6. [ ] The fuller case-management growth path (durable Case entity,
   Statuses/Queues/Checklists/Automations, the MCP-written AI summary)
   is recorded as design input in SPEC §3.2.1 — future research, not
   this goal's scope.

## Acceptance
Run the seeded review example plus a guardrail ask; both flows are
filterable, resolutions are visible after the fact, and the sidebar
shows pending count — judged live by the owner.
