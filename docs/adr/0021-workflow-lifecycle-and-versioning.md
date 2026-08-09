# ADR-0021: Workflow lifecycle & versioning — draft/publish, disable, pinning

Status: accepted

## Context

Requested directly: "the version that publish live workflow in general
including shadow ... we need to comprehensively complete those now,"
plus a follow-up clarifying that **live and publish are one concept**
and that an **inactive** (enabled/disabled) state belongs in the model
too. `docs/SPEC.md` §3.2 has carried this as a named gap since the
reference-platform review ("edits create a new version; versions are
tested/validated, saved as a draft, then promoted live"); §3.3's
capability map row said "Build (no library owns Mill's own versioning
semantics)."

Research, verified against primary sources — not assumed:

- **DBOS (installed v1.0.0, read directly from its source)**:
  `ApplicationVersion` versions the *application binary* (recovery only
  targets runs whose version matches; the conductor can list/set
  versions) — it does **not** version Mill's workflow *definitions*,
  which are data (JSON in the settings store), not code.
  `ForkWorkflow` re-runs an existing run from a step (already used by
  Redrive). So DBOS contributes run-level machinery; the definition
  lifecycle is Mill's own, exactly as the capability map predicted.
- **n8n**: `active` is a per-workflow boolean gating *trigger
  listeners only* — manual execution is always allowed on an inactive
  workflow. Version history with restore exists as its own feature.
  This is the precedent for Mill's disable semantics.
- **Reference platform (§3.2, recorded previously)**: edits create
  versions; a draft is tested against a single record before being
  promoted live; shadow evaluates a candidate version against real
  traffic without taking effect.

## Decision

**Model — three additive fields on `Workflow`, no new entity:**

- `Versions []WorkflowVersion` — immutable snapshots
  (`{Version, SavedAt, Label, Description, Nodes, Edges, Attributes}`),
  monotonically numbered. Stored inline on the workflow in the same
  settings blob — at Mill's scale (hand-authored workflows, not
  machine-generated thousands) snapshot-per-publish is simple and
  sufficient; an external store is a premature optimization.
- `PublishedVersion int` — which snapshot is **live** (publish ≡ live,
  one concept). `0` = never published.
- `Disabled bool` — the inactive state. Field is `Disabled` (not
  `Active`) so the JSON zero value of every already-persisted workflow
  means "active", making the field migration-free.

**Semantics:**

- The workflow's own head (`Nodes`/`Edges`/`Attributes`) is the
  **draft** — what the canvas edits and what Save writes. Save does
  not publish.
- **Publish** snapshots the head as the next version and points
  `PublishedVersion` at it. Republishing an older version just moves
  the pointer (rollback without mutation); "load into draft" copies a
  snapshot back into the head for further editing.
- **Execution resolution** (`ExecutionService`): a `test` run (the
  list's Run button, the pre-publish check) executes the **draft**
  head — that's the reference platform's own test-before-promote
  story. A `triggered` run (hotkey/schedule/watchers) and a
  child-workflow invocation execute the **published** snapshot; both
  are rejected on an unpublished or disabled workflow.
  `TriggerService.Sync` additionally skips disabled/unpublished
  workflows when registering listeners, so a schedule never even
  arms. Test runs stay allowed on a disabled workflow (n8n's exact
  semantics — disabling pauses production, not debugging).
- **Version pinning**: `child-workflow` gains an optional `version`
  config — empty means "the published version" (a moving pointer);
  a number pins the child to that exact snapshot forever.
- **Every run records which version executed** (`runInput.Version`,
  0 = draft), surfaced in run summaries.
- **Migration**: on restore, any workflow with no versions and no
  published pointer (everything persisted before this ADR, and every
  seeded built-in) is auto-published as v1 — existing triggers keep
  firing across the upgrade with zero behavior change.

## Explicitly deferred — named, not silently dropped

- **Shadow evaluation** (running a draft against real trigger traffic
  without taking effect): unlike the reference platform's pure
  decisioning workloads, Mill's nodes have real side effects
  (clipboard writes, HTTP calls, MCP tools) — a shadow run that
  "doesn't take effect" requires a per-node purity/suppression model
  that belongs to §8's guardrail work. Deferred with reasoning, not
  forgotten; the version model here (draft vs. published, per-run
  version stamps) is exactly the substrate shadow needs when it comes.
- **Staged-traffic promotion** (percentage rollout): meaningless at
  single-user scale today; the `PublishedVersion` pointer is the seam
  a traffic-splitter would replace.
- **Version diffing UI**: the version list shows metadata; a visual
  node-graph diff is its own design pass.

## Consequences

- A brand-new workflow is runnable immediately (test = draft) but its
  triggers arm only after first publish — friction is the default,
  going-live is the explicit act (§8's fail-safe posture applied to
  the lifecycle).
- Seeded examples ship published (the migration publishes them as v1),
  and the parent/child seeds demonstrate pinning: the child carries a
  v1 snapshot plus a newer draft, and the parent pins v1 — running the
  parent proves the pin (the draft's changed output does not leak).
