# Goal 0021 — MCP dogfood: gap closure toward real-use readiness

Standing dogfood effort, owner-mandated 2026-08-11 ("start having you
test all these and find gaps on what is missing to make it become
real useful for real use cases"). The orchestrator drives Mill's real
MCP surface against the locked-down-enterprise use cases (memory
the enterprise-reality context) and logs gaps here; each gap graduates
to a fix in priority order. Findings from live probing of the running
instance, not code reading.

## Phase 1 — read/introspection surface (2026-08-11 probed, 2026-08-12
gaps 2-4 closed — Phase 1 now fully complete: every gap either fixed or
explicitly declined/confirmed-by-design. Phase 2 probed and its gaps
closed 2026-08-13 (Phase 3 below); Phase 4 (real-use-case fidelity)
remains open.)

What already works well, verified live: `list_node_types` is a real
authoring vocabulary (full typed ConfigFields, defaults, options,
effect class per entry); `validate_workflow` returns structured
`{valid, issues[]}`; `get_run` on fresh runs carries per-step
`inputAttributes`/`outputAttributes` + guardrail verdict/source;
`run_workflow` correctly routes a typed value through Branch to the
right terminal Decision.

### Gaps, ranked

1. ~~**[HIGH] `run_workflow`/`run_workflow_stepped` have no `payload`
   argument**~~ — **FIXED same day** (both tools accept `payload`,
   threaded through `RunWorkflowWithPayload`/the stepped param;
   proven by `TestMCPRunWorkflow_PayloadFlowsIntoCaptureFile`, a
   real MCP client running a capture-file workflow against a real
   temp file). Trigger-fed workflows are now testable over MCP.
2. ~~**[MED] Parked/stepped runs leak DBOS parking machinery
   (`DBOS.setEvent`/`DBOS.recv`/`DBOS.sleep`) as pseudo-steps** in
   `get_run`'s step list (empty nodeTypeID) — noise on exactly the
   runs a debugger inspects most.~~ — **Already fixed, verified
   2026-08-12.** Investigation found this was the exact same bug
   goal 0026's PR fixed the same day this gap was logged (commit
   `3e0433e`, "run detail no longer shows DBOS system steps as
   blank rows"): the `"DBOS."` step-name-prefix filter in
   `GetRun` (executionservice_getrun.go) already covers every DBOS
   system op (verified against the installed `dbos-transact-golang`
   source — every system step, not just setEvent/recv/sleep, uses
   the uniform prefix), and the stepped/breakpoint flow
   (`RunWorkflowStepped`) parks through the exact same
   `parkForApproval` mechanism as an ordinary guardrail-policy ask,
   so it was already covered too — confirmed by tracing
   `executionservice_guardrail.go`, not assumed. What was missing:
   a proof for the stepped-flow case specifically (only the
   guardrail-approval-park case had a "no pseudo-step" assertion).
   Added `assertNoDBOSPseudoSteps`, applied to
   `TestStepMode_ParksBeforeEveryNode_StepThenContinue` at both the
   first park and the final resolved-run `GetRun`
   (breakpoint_test.go). The UI Runs tab calls the same `GetRun`
   RPC, so no separate check needed there.
3. ~~**[LOW-MED] Per-step `input` (payload) field unverified** in
   `get_run` — `inputAttributes` present on fresh runs, but no
   `input` key appeared (possibly omitempty + an empty first-step
   input).~~ — **Fixed 2026-08-12.** Verified via a new real
   multi-step run with a non-empty payload
   (`TestGetRun_MultiStepInput_PopulatedAndChained`,
   executionservice_getrun_test.go): the mapping itself was already
   correct (each step's `Input` is the prior executed step's
   `Output`, or the run's own seeded payload for the first step).
   The actual bug was the suspected cause: `RunStep.Input` carried
   `omitempty` while the sibling `Output` field didn't — an
   asymmetry that silently dropped the JSON key on a genuinely-empty
   first-step input, indistinguishable over MCP from a real mapping
   failure. Removed `omitempty` from `Input`
   (executionservice.go) so the key is always present, matching
   `Output`'s own convention; bindings regenerated.
4. ~~**[LOW] `validate_workflow` on a graph with a cycle reports only
   "must have exactly one starting node"** — true but unhelpful;
   naming the cycle would let an authoring agent fix it in one
   round trip instead of discovering it after removing the wrong
   edge.~~ — **Fixed 2026-08-12.** Two distinct cycle shapes existed:
   (a) a pure cycle with no root at all (`findRoot`'s zero-root
   case, graph.go) — now names the actual looping node IDs via a
   new `findAnyCycle` DFS helper (`graph_cycle.go`, split out to
   stay under the 500-line file limit), e.g. "these nodes form a
   cycle: a -> b -> c -> a"; and (b) a cycle reachable from a
   perfectly valid single root but looping further downstream
   (execute.go's runtime walk, previously a bare "workflow graph
   contains a cycle") — `ValidateGraph`'s save-time reachability
   check doesn't catch this shape at all (every looping node IS
   reachable from the root, so nothing is flagged "unreachable");
   only actual execution's traversal does, and its error now names
   the real loop too (e.g. "a -> b -> a"), tracking each visited
   node's position in traversal order instead of a bare seen-set.
   Proven by two new tests in graph_test.go
   (`TestFindRoot_PureCycle_NamesTheLoopingNodes`,
   `TestExecuteWorkflow_CycleDownstreamOfARealRoot_NamesTheLoopingNodes`)
   against real cyclic graphs run through `ExecuteWorkflow`/
   `ValidateGraph`, not just unit-testing the helper in isolation.
5. **Corrected finding (initially misread):** `run_workflow` IS
   gated by the writes toggle (`requireWriteEnabled`,
   millmcpservice_authoring.go:249) — it succeeded in probing
   because **the toggle was already ON in this instance's
   settings** (left enabled from goal 0003's live dogfood on the
   same settings.json). Owner awareness item: the toggle's state
   predates today and nothing surfaces it ambiently — worth a
   visible indicator (e.g. the Settings gear or footer noting "MCP
   writes enabled") so a long-forgotten toggle isn't invisible
   standing authority. Logged as gap, LOW-MED.

## Phase 2 — authoring + step-debug loop (2026-08-13 live-probed by the
orchestrator against a real MCP client — the planned author-from-
scratch + full `run_workflow_stepped` session probes below; now
complete)

Planned probes: author a workflow from scratch via
`validate_workflow`→`import_workflow`→`update_workflow`; per-write
approval UX friction; a full `run_workflow_stepped` session
(inspect→edit→step) once gap 1 is fixed; canvas-live-sync
verification (the in-flight build) — owner watches the canvas while
the MCP author works.

**Positive finding, proven live, not assumed:** the full author→run→
inspect loop works end to end over a real MCP client — validate→
import→update→run→get_run all round-tripped correctly, per-write
approval gated each mutation as designed, and a real
`run_workflow_stepped` session (inspect→step→resume) advanced node by
node exactly as ADR-0031 describes. No new gap in the loop mechanics
themselves.

**Gaps found, both closed same day (Phase 3 below):**

6. ~~**[MED] Inconsistent identifier argument names across the tool
   surface**~~ — **FIXED 2026-08-13.** The live probe burned failed
   round trips guessing argument names: `import_workflow{json}`,
   `run_workflow{id,values,payload}`, `update_workflow{id,json}`,
   `export_workflow{id}` all took a bare `id`, while `get_run{runId}`
   and `list_runs{workflowId}` already used more explicit names —
   validation errors were readable, but the inconsistency itself was
   pure interop friction, not a real design difference across entity
   kinds. Fixed at the argument-resolution level: a single
   `workflowIDArgs` struct (`WorkflowID`/`ID`, canonical name first)
   embedded by every workflow-identifying tool
   (`run_workflow`/`run_workflow_stepped`/`update_workflow`/
   `publish_workflow`/`delete_workflow`/`export_workflow`), with one
   shared `resolve()` deciding which wins if a caller sends both —
   never per-tool copy-paste. `get_run`/`list_runs`/`step_run`/
   `resume_run`/`stop_run` already used their own canonical names
   (`runId`/`workflowId`) before this fix. Fully backward compatible —
   `id` keeps working unchanged. Proven by
   `TestMCPIdentifierAliases_CanonicalNamesResolveAcrossTheSurface`
   (every tool driven end to end using ONLY the new canonical names)
   and `TestMCPIdentifierAliases_LegacyIdStillResolves` (the original
   `id` name, real MCP client, real HTTP).
7. ~~**[MED] `run_workflow` always landed `test` kind, no way to opt
   out**~~ — **FIXED 2026-08-13.** Externally-triggered production
   runs were silently excluded from Home's automation metrics by
   default (`RunKindTest` is the one kind Home's Ambient/TimeSaved/
   ErrorRate framing always excludes) — wrong for a real agent
   invoking a workflow for real, not authoring/debugging it.
   `run_workflow` gained an optional `test` boolean (default `false`):
   `false` now lands a new `RunKindMCP` run kind, counted in Home's
   metrics exactly like a genuine trigger fire; `test:true` still lands
   `RunKindTest`, matching the UI's own Test-run button. Deliberately a
   DISTINCT kind from `RunKindTriggered` rather than reusing it: no MCP
   tool offers a "run the published version" choice the way a real
   trigger fire does (ADR-0021 locks trigger/child-call execution to
   the published snapshot) — both `test` and the new `mcp` kind still
   execute the current DRAFT head; only the metrics classification
   changes (`RunKind.runsDraft`/`RunKind.isTest`,
   `internal/services/executionsvc/executionservice_runkind.go`).
   `run_workflow_stepped` intentionally has no `test` argument at all
   and always stays `RunKindTest` — a debug/inspection surface (pauses
   before EVERY node), never production automation, documented as such
   in its own tool description. Proven by
   `TestMCPRunWorkflow_TestFlagControlsRunKindAndHomeVisibility`: the
   default run lands `mcp` kind and counts in
   `HomeMetrics(...).Ambient.TriggeredCount`; `test:true` lands `test`
   kind and counts in `.Ambient.ManualCount`; `run_workflow_stepped`
   stays `test` regardless.

## Phase 3 — MCP tool surface gap closure (2026-08-13, delivered)

Both Phase 2 gaps above (6, 7) fixed same day as found, full local
suite green, PR self-merged. This closes everything actionable that
Phase 2's live probing surfaced — no other judgment calls came up
needing the owner (the mandate's own "Phase 3 judgments that need the
owner surface as found" case never triggered this round).

## Phase 4 — real-use-case fidelity (partially unblocked, still open —
distinct from Phase 3 above, a different scope: fidelity/breadth work,
not tool-surface ergonomics)

- **Markdown fidelity on realistic Confluence HTML** — the actual
  daily-pain quality bar: tables, code blocks, panels/macros, nested
  lists through `process-extract-html` → `html-to-markdown`. Build a
  realistic fixture corpus; assess where structure survives and
  where it degrades; feed findings into the ADR-0030 checklist trip.

  **Research delivered 2026-08-13 (agent-run, empirically verified
  against the exact `html-to-markdown` v2.5.2 in go.mod):**
  - **[HIGH — the headline]** `internal/adapters/markdown/markdown.go`
    calls the library's bare `htmltomarkdown.ConvertString`, which
    wires only `plugin/base` + `plugin/commonmark` — **not
    `plugin/table`** — so every Confluence table converts to one
    run-on text line with all row/column structure destroyed
    (verified: `RegionQ1Q2 EMEA1012 Growing`). Fix is adding the
    library's own `plugin/table` (+ `plugin/strikethrough`) via
    `converter.NewConverter`; colspan/rowspan then flatten per the
    plugin's documented GFM behavior (spanned content top-left,
    blanks elsewhere), which is the correct ceiling for pipe tables.
  - **Fixture corpus: hand-write it (12 cases specified).** No
    adoptable corpus exists — checked the library's own goldens
    (generic, not Confluence), pandoc (no Confluence reader),
    cjberg/confluence-to-markdown (stale 2023, decade-old Server
    markup), highsource/confluence-to-markdown-converter (storage-XML
    input, wrong shape, dead 2017), Spenhouet/confluence-markdown-
    exporter (MIT, live, best rendered-markup ground truth — but
    Python; reference source only). Case list with real Cloud markup
    (class names corroborated against Spenhouet's tested converter +
    Atlassian docs): table w/ colspan+rowspan; code-block macro
    (`data-syntaxhighlighter-params="brush: java"` — language hint
    silently dropped today, the library only reads `language-*`
    classes); info/note/warning/tip panels (panel TYPE lost);
    3-level nested lists (works, keep as regression); task lists
    (`ak-task-list` — checkbox state dropped, no GFM `- [x]`);
    expand macro (collapse semantics lost; Spenhouet re-renders as
    `<details>`); status lozenges (semantic color lost); multi-column
    layouts (acceptable linearization); page links/mentions (works);
    emoticons (`data-emoji-fallback` — currently emits a DEAD image
    link, worse than dropping); panel-inside-table-cell; bare `<pre>`
    negative control.
  - Full report with sources + verified converter outputs in the
    session transcript; per-case snippets land with the fixture
    corpus itself.
- **§2.1 M365 bridge dry run** — compose capture→code-exec→clipboard
  end-to-end with the pieces that exist; name what's still missing
  (DOM capture, auto-paste target).
- ~~**AI node** (§3.3 map row, invariant locked)~~ — **DELIVERED via a
  separate goal, [0031 — AI node family](archive/0031-ai-node-family.md),
  2026-08-12**, not this goal's own work; struck here so this list
  doesn't read as still-outstanding.

## Acceptance (rolling)

Each phase's gaps either fixed (with the standing proof discipline)
or explicitly declined with a recorded reason; the phase-2/3 probes
run and their findings logged here; this file graduates items out as
they land, and archives when the owner calls the surface
real-use-ready. **Not archived yet as of Phase 3's 2026-08-13
delivery**: Phase 4's Confluence-markdown-fidelity and M365-bridge
items remain genuinely open, substantial, unaddressed work — this
session's scope was Phase 2/3's tool-surface gap closure only, and the
file's own archival bar is the owner calling the surface real-use-ready,
not an agent's unilateral judgment that one phase's items closed.
