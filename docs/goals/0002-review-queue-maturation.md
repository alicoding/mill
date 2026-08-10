# 0002 — Review queue maturation

## Goal
The Review queue works as the case-management-style inbox from
`docs/SPEC.md` §3.2/§8 (ADR-0023) for real daily use — without
crossing the no-Camunda line (no assignment/SLA/notes).

## Plan
1. Filters: workflow + kind over pending items.
2. Recently-resolved visibility (approved/denied/timed-out outcomes,
   from the already-recorded resolution events).
3. A pending-count signal on the sidebar Review entry.
4. Empty/loading polish per the overhaul's spacing standards.

## Acceptance
Run the seeded review example plus a guardrail ask; both flows are
filterable, resolutions are visible after the fact, and the sidebar
shows pending count — judged live by the owner.
