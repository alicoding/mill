package executionsvc

// RunKind classifies why a run started (docs/adr/0008) -- "test" for a
// manual/UI-driven run (Composition's canvas Run button, the Runs page's
// own quick-run picker), "triggered" for a real external event
// (TriggerService's headless listeners), "mcp" for an external MCP
// client's run_workflow call with test:false (goal 0021 Phase 3 gap 2).
// Not a DBOS SetWorkflowAttributes call -- travels in runInput alongside
// every other per-run value, the existing pattern this struct already
// uses. Split out of executionservice.go once that file crossed the
// 500-line limit (CLAUDE.md/§1.3) -- RunKind's own classification rules
// are a genuinely separable concern from starting/listing/redriving a
// run, the same "split along a real seam" discipline
// executionservice_summary.go/executionservice_home.go already applied.
type RunKind string

const (
	RunKindTest      RunKind = "test"
	RunKindTriggered RunKind = "triggered"
	// RunKindMCP marks a run an external MCP client explicitly started
	// "for real" (run_workflow's test:false, the default -- goal 0021
	// Phase 3: the live probe found every MCP run started as "test"
	// with no way to opt out, wrong for a production agent invoking a
	// real workflow, and silently excluded from Home's metrics by
	// default). Deliberately distinct from RunKindTriggered: no MCP
	// tool offers a "run the published version" choice the way a real
	// trigger fire does (ADR-0021 locks trigger/child-call execution to
	// the published snapshot) -- see RunKind.runsDraft's own doc
	// comment. RunKindMCP still counts as real automation everywhere
	// Home's metrics distinguish "test" from everything else (see
	// isTest below), just like RunKindTriggered.
	RunKindMCP RunKind = "mcp"
)

// isTest reports whether kind is the manual/authoring "test" kind --
// the one RunKind value Home's automation-vs-manual framing (Ambient/
// TimeSaved/ErrorRate's default scope, executionservice_home.go)
// always excludes. Every other kind (a real trigger fire, or an MCP
// client's run_workflow with test:false) counts as real automation
// Mill did on the user's behalf, not a human clicking Run/Test.
func (k RunKind) isTest() bool { return k == RunKindTest }

// runsDraft reports whether kind executes the workflow's DRAFT head
// rather than its published snapshot (ADR-0021's test/triggered split,
// extended for RunKindMCP). RunKindTest and RunKindMCP both run the
// draft -- an MCP client's run_workflow never offers a "run the
// published version" choice at all, unlike a real trigger fire, which
// ADR-0021 locks to the published snapshot -- so run_workflow's
// test:false only changes what the run COUNTS as for Home's metrics,
// never which version it executes.
func (k RunKind) runsDraft() bool { return k == RunKindTest || k == RunKindMCP }
