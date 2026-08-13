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
explicitly declined/confirmed-by-design. Phase 2/3 remain open below,
unblocked but not yet run -- they need live interactive probing, not
code changes.)

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

## Phase 2 — authoring + step-debug loop (unblocked — the writes
toggle is already on; per-write approval still gates each import)

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
