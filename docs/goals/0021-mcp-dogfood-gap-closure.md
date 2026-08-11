# Goal 0021 — MCP dogfood: gap closure toward real-use readiness

Standing dogfood effort, owner-mandated 2026-08-11 ("start having you
test all these and find gaps on what is missing to make it become
real useful for real use cases"). The orchestrator drives Mill's real
MCP surface against the bank use cases (memory
`project-mill-bank-reality`) and logs gaps here; each gap graduates
to a fix in priority order. Findings from live probing of the running
instance, not code reading.

## Phase 1 — read/introspection surface (2026-08-11, done)

What already works well, verified live: `list_node_types` is a real
authoring vocabulary (full typed ConfigFields, defaults, options,
effect class per entry); `validate_workflow` returns structured
`{valid, issues[]}`; `get_run` on fresh runs carries per-step
`inputAttributes`/`outputAttributes` + guardrail verdict/source;
`run_workflow` correctly routes a typed value through Branch to the
right terminal Decision.

### Gaps, ranked

1. **[HIGH] `run_workflow`/`run_workflow_stepped` have no `payload`
   argument** — an MCP agent cannot test any trigger-fed workflow
   (the capture floor, the whole ADR-0030 near-term hero path). The
   exact dead-end the UI's Run dialog got fixed for the same day
   (Initial-payload field); the MCP surface never got the parallel
   fix. Small: thread the same `RunWorkflowWithPayload`/stepped
   param through the two tools' schemas.
2. **[MED] Parked/stepped runs leak DBOS parking machinery
   (`DBOS.setEvent`/`DBOS.recv`/`DBOS.sleep`) as pseudo-steps** in
   `get_run`'s step list (empty nodeTypeID) — noise on exactly the
   runs a debugger inspects most. Filter (or label) them in
   `GetRun`; check whether the UI Runs tab renders the same noise.
3. **[LOW-MED] Per-step `input` (payload) field unverified** in
   `get_run` — `inputAttributes` present on fresh runs, but no
   `input` key appeared (possibly omitempty + an empty first-step
   input). Verify on a multi-step run with a real payload; fix the
   mapping if genuinely missing.
4. **[LOW] `validate_workflow` on a graph with a cycle reports only
   "must have exactly one starting node"** — true but unhelpful;
   naming the cycle would let an authoring agent fix it in one
   round trip instead of discovering it after removing the wrong
   edge.
5. **Confirmed by design, not a gap (owner should know):**
   `run_workflow` executes WITHOUT the writes toggle — ADR-0025's
   position that the guardrail engine is the run's own approval
   layer (local-effect workflows run straight through; external
   steps still park for a human). Revisit only if the owner wants
   run-starting itself gated.

## Phase 2 — authoring + step-debug loop (blocked on the owner
flipping Settings → "Allow MCP clients to import data")

Planned probes: author a workflow from scratch via
`validate_workflow`→`import_workflow`→`update_workflow`; per-write
approval UX friction; a full `run_workflow_stepped` session
(inspect→edit→step) once gap 1 is fixed; canvas-live-sync
verification (the in-flight build) — owner watches the canvas while
the MCP author works.

## Phase 3 — real-use-case fidelity (partially unblocked)

- **Markdown fidelity on realistic Confluence HTML** — the actual
  daily-pain quality bar: tables, code blocks, panels/macros, nested
  lists through `process-extract-html` → `html-to-markdown`. Build a
  realistic fixture corpus; assess where structure survives and
  where it degrades; feed findings into the ADR-0030 checklist trip.
- **§2.1 M365 bridge dry run** — compose capture→code-exec→clipboard
  end-to-end with the pieces that exist; name what's still missing
  (DOM capture, auto-paste target).
- **AI node** (§3.3 map row, invariant locked) — still unbuilt; the
  local-Ollama variant is the zero-egress win. Research pass owed
  before building.

## Acceptance (rolling)

Each phase's gaps either fixed (with the standing proof discipline)
or explicitly declined with a recorded reason; the phase-2/3 probes
run and their findings logged here; this file graduates items out as
they land, and archives when the owner calls the surface
real-use-ready.
