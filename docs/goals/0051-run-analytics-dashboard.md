# 0051 — Run-analytics dashboard v2

**Raised:** 2026-08-13, owner-directed: research what workflow
products actually show on their analytics surfaces and build a more
useful dashboard from Mill's local run history than the current Home
set (time-saved accounting, ambient/manual run counts, most-used
list, one runs+success-rate chart).

## Constraints (fixed going in)

- Local-only, forever: every metric computes from the on-disk run
  history; no phone-home (SPEC §1.1). Multi-user/enterprise metrics
  that require telemetry or shared context are out by construction.
- Recharts stays the chart layer (goal 0014's recorded
  adopt-decision: theme-aware SVG via Primer tokens, lazy-loaded);
  revisit only on a demonstrated capability gap, not preference.
- Time-saved stays formula-transparent (goal 0014's Layer-1 value
  accounting) — new metrics join it, never replace it with a
  black-box score.

## Research (DELIVERED 2026-08-13 — survey of n8n Insights, Zapier,
Make, Activepieces, Windmill, Node-RED, Temporal Web UI, Airflow,
Power Automate; full per-product findings + sources in the session
record, verdicts here)

Headline: Home (goal 0014) already covers most of the converged set —
run volume + status over time, error rate with denominator,
per-workflow breakdown, editable time-saved (only n8n and Zapier ship
that; Mill is ahead there). The survey's converged-but-missing items:

1. **Average run duration** — n8n headline metric, Airflow
   table-stakes. Free derivation from RunSummary's
   StartedAt/CompletedAt; a KPI stat + a duration column extending
   the Most-Used table into n8n's per-workflow shape
   (runs/failures/rate/time-saved/avg-duration). No schema change.
2. **Trigger-recency signal** — "this hasn't fired in N days"
   (Airflow landing-times / n8n schedule-produced-nothing class,
   goal 0014's own unbuilt Layer-3 insight). Buildable today only as
   a workflow-level proxy (MAX(StartedAt) over non-test runs per
   workflow); true trigger-level health needs a fire-log that
   doesn't exist (see data-model gaps).
3. **Node-type failure breakdown** ("most failures come from
   integration-http steps") — Power Automate error-report class;
   derivable from RunDetail.Steps' NodeTypeID+Error today. Belongs
   on the Activity/Runs surface, not a Home KPI (needs per-step
   data Home's aggregate query doesn't fetch).

**Named data-model gaps (deferred, deliberately — the visualization
must not precede the data, SPEC §3.2.3's own trap):** per-step
timestamps in the checkpointed RunStep record (blocks Airflow-class
Gantt/per-node-duration views; touches the DBOS step write path —
its own goal with a capability map if bottleneck diagnosis becomes a
stated need); a trigger fire-log in triggersvc (blocks true
trigger-health; today a never-firing trigger is indistinguishable
from an unused one).

**Rejected, with reasons:** Power Automate's creator/tenant/connector
admin reports (multi-user only — no "creator" distinct from "the
user"); Temporal/Windmill fleet-worker/queue health (no worker fleet
in a desktop process); n8n's paid-tier gating (a licensing pattern,
not a feature); Zapier's scheduled CSV/email exports (solves
cloud-retention limits Mill's permanent local SQLite doesn't have);
a second chart for duration trends (KPI/table cells absorb it; the
one paired volume+rate ComposedChart stays, per n8n/Make precedent);
live-streaming dashboard (already satisfied by mill-data-changed +
Home's subscription, goal 0017).

## Plan shape

Home evolution, not a parallel Analytics page: item 1 (duration KPI +
per-workflow column, Go aggregation + Home UI), item 2 (recency
insight line, clearly a workflow-level proxy), item 3 (failure
breakdown on Activity). Seeded workflows must generate enough run
variety for every new metric to render non-empty (seeds ARE the
proof, testing.md); duration math gets Go-side unit coverage.

## Acceptance (checkable)

- [ ] Avg-duration KPI + per-workflow duration column live, computed
      from existing timestamps, Go aggregation unit-tested.
- [ ] Trigger-recency insight renders for a seeded scheduled
      workflow; copy honest about being workflow-level.
- [ ] Node-type failure breakdown on the Activity surface, derived
      from existing step records.
- [ ] The two data-model gaps stay recorded here as deferred with
      their trigger conditions — not silently forgotten, not built
      speculatively.
- [ ] Any data-model change carries its capability map + migration
      note (ADR if schema semantics change).
- [ ] Every new metric renders non-empty from seeded data alone,
      covered at the right test layer (Go for aggregation math, e2e
      for the surface).
- [ ] Home's existing metrics (time-saved formula, ambient/manual
      split, most-used) survive or are consciously superseded with
      the reasoning recorded here — never silently dropped.
