# 0014 — Home: operational launch dashboard

## Goal
A landing surface per SPEC §3.2.3's reference review: suggested/recent
workflow cards (reusing goal 0006/0007's exact badges and row
identity — never a second lifecycle vocabulary), an extensible KPI row
over governed metric definitions, one shared time-range context, and
paired volume+rate charts over run history — summarize and
drill-through only, never author, never a second source of truth.

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
