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

## Hard constraints from the review + Mill's own doctrine
- Adopt, don't invent: charting/metrics/time-series via an existing
  library or capability (research pass first — the dataviz skill's
  guidance applies to any chart Mill renders; candidates researched
  when scheduled, not guessed now).
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
