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
   there rather than polling.
4. [ ] Kind filter + empty/loading polish per the overhaul's spacing
   standards.

## Acceptance
Run the seeded review example plus a guardrail ask; both flows are
filterable, resolutions are visible after the fact, and the sidebar
shows pending count — judged live by the owner.
