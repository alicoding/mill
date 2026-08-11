# 0014 — Home: the value mirror (owner's framing) + operational launch surface

## Goal
**Owner's core vision (2026-08-10, direct): Home is the reason to
open Mill — it justifies the tool with the user's own data.** Time
saved, most-used workflows, what Mill did while the window was
closed, and what the user can LEARN from their own patterns. Mill's
twist on the reference platform's ops dashboard (§3.2.3): personal
value-accounting first, tenant ops second — and everything derivable
from already-local durable data (DBOS run history, trigger logs,
approval records): zero telemetry, §1.1 untouched.

## The three layers
1. **Value accounting, honest math only**: per-workflow
   "minutes saved per run" is a USER-CONFIGURABLE estimate (the
   preferences hook doing real work; sensible default by node
   composition), and every displayed total shows its formula
   (`31 runs × ~4 min = ~2.1 hrs`) — never fake precision. Zapier's
   tasks-automated counter is the retention precedent.
2. **Usage mirror**: most-used workflows, trigger-source breakdown
   (ambient-vs-manual fire ratio — "Mill worked while the window was
   closed" is arguably THE metric), failures/approvals, trends over
   the one shared time range.
3. **Learning layer — insights that convert usage into
   configuration**, each linking to its exact action (drill-through
   requirement satisfied): "manually run 12× — assign a hotkey?",
   "fails 40% — open the last failure", "this schedule produced
   nothing in a week."

Plus the launch half: pinned/recent workflow cards reusing goal
0006/0007's exact badges/rows (never a second lifecycle vocabulary),
quick create, the pending-attention count (0005).

## Charting library — DECIDED (research 2026-08-10): Recharts (MIT)
Ranked against Chart.js/visx/uPlot/Observable Plot/plain-D3 on primary
sources. Recharts wins on two load-bearing points, not bundle size:
(1) `ComposedChart` IS the paired bar+line dual-axis shape this goal
needs, batteries-included (tooltip/legend/ResponsiveContainer) — visx
is a primitives toolkit that would make Mill hand-build that
(architecture.md's ownership-burden trap); (2) **SVG rendering inherits
Primer's CSS-variable cascade on a theme toggle for FREE** — canvas
libs (Chart.js/uPlot) require manual palette re-resolution + redraw on
every light/dark switch, real avoidable glue for the one property the
goal calls out. Mitigate its ~147KB gzip by **lazy-importing the chart
component only when Home mounts** (the elkjs precedent, SPEC §3.3).
KPI cards need NO library — Primer Text/Heading render the value-
accounting numbers directly. Primer has no first-party charting (only
color/contrast guidelines — drive Recharts marks from Primer tokens
per those). No Rust in any candidate's tree (constraint clean).

## Metric semantics — DECIDED by industry research (2026-08-10)
Confirmed Mill's drafted approach matches/exceeds industry (Zapier +
Power Automate both expose an editable per-run time estimate; nobody
credible fakes precision). Adopt, each vendor-generic in SPEC:
- **Time saved** = Σ over completed runs of a per-WORKFLOW
  user-editable minutes-saved estimate (Zapier's per-Zap granularity,
  default 2min/task there — Mill seeds by node composition); formula
  always visible/editable. Credit ONLY `RunKind: triggered` +
  Success runs — a `test` run is authoring, not automation replacing
  manual work (crediting it = Zapier crediting an editor preview).
  Failed run credits nothing.
- **Error rate** = failed-terminal runs / (Success + Error terminal
  runs). Retry-then-success = Success, NOT a failure (Temporal/n8n/
  Airflow all agree — the unit is the run, not the attempt; DBOS's
  own step-retry already absorbs this). Parked/waiting runs EXCLUDED
  from the denominator until resolved (Zapier convention). Cancelled
  runs excluded from both (Airflow's deliberate-stop ≠ failure).
  Default scope `triggered` only (n8n's manual-exclusion), with a
  test-included toggle.
- **Aggregation**: machine-local timezone unconditionally (single-
  viewer desktop — no UTC/display split needed); DAILY buckets
  default (RescueTime/Toggl/GitHub personal-tool convention, not
  hourly); NEVER a bare percentage without its volume, and gray/
  suppress a rate below a minimum run count (Datadog's own 1-of-1 =
  100% failure mode + small-N stats).
- Every metric's definition (numerator/denominator/retry/RunKind
  treatment) rendered inline/on-hover — the reference review's own
  explicit demand.

## Other hard constraints from the review + Mill's own doctrine
- Metric definitions document numerator/denominator/retry/test-kind
  treatment/interval explicitly; RunKind test-vs-triggered treatment
  is Mill's own first metric-semantics decision.
- Depends on: run-evidence/§9.5 groundwork for explainable history;
  goal 0005's eventing for freshness; run-history pagination (0007
  follow-up) before volume charts mean anything at scale.

## Acceptance
Owner lands on Home, recognizes it instantly (the standing
recognition bar), and every number on it links to the exact filtered
evidence behind it.
