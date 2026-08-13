package composition

import (
	"github.com/alicoding/mill/internal/domain/capabilities"
)

// Approach records whether a capability's mechanism is bought (an
// existing library) or must stay Mill's own hand-written code, per
// CLAUDE.md's adopt-over-hand-roll rule. Mixed means a capability splits
// cleanly into an adoptable mechanism plus a composition rule that can't
// be bought regardless of mechanism -- see ApproachDetail for which is
// which.
type Approach string

const (
	ApproachAdopt Approach = "adopt"
	ApproachBuild Approach = "build"
	ApproachMixed Approach = "mixed"
)

// MapEntry is one row of Mill's composition capability map -- real Go
// data mirroring docs/SPEC.md §3.3's table, the same "authoritative
// machine-read projection, SPEC.md's own tags stay human-readable
// commentary" relationship internal/domain/capabilities already has to
// its own SPEC.md sections (§2.2's decision record). SPEC.md §3.3 is the
// source of the reasoning; this is what the UI reads.
type MapEntry struct {
	ID             string
	Name           string
	WhatItDoes     string
	Approach       Approach
	ApproachDetail string
	Status         capabilities.Status
	StatusDetail   string
}

// CapabilityMap lists every known composition capability -- built or
// not -- so the schema/adopt-vs-build decision for §3 gets made against
// the full known need, not just today's two linear built-in workflows.
// See docs/SPEC.md §3.3 for the full reasoning behind each row.
func CapabilityMap() []MapEntry {
	return []MapEntry{
		{
			ID: "capture-process-apply", Name: "Capture / Process / Apply",
			WhatItDoes:     "Read structured state from a source, transform it, deliver it.",
			Approach:       ApproachBuild,
			ApproachDetail: "Core domain -- Mill's own already-locked primitive (§2).",
			Status:         capabilities.StatusLocked,
			StatusDetail:   "Built for clipboard/markdown.",
		},
		{
			ID: "trigger", Name: "Trigger",
			WhatItDoes: "Entry-point node: listen for any event source (hotkey, clipboard " +
				"change, a browser-bridge DOM event, an incoming MCP tools/call, a schedule) " +
				"and emit its data as the workflow's starting input -- not just \"the hotkey " +
				"mechanism,\" a general category the hotkey is one instance of. A trigger's " +
				"output is the workflow's input; these are one concept, not two.",
			Approach: ApproachMixed,
			ApproachDetail: "Each concrete event source adopts its own library behind an " +
				"adapter (hotkey, schedule via netresearch/go-cron, filesystem-watch via " +
				"fsnotify/fsnotify); clipboard-watch is a small build (no library needed, " +
				"confirmed no OS event exists to adopt). The abstraction unifying them into " +
				"one node kind, and TriggerService's own registry/exclusivity rules, are " +
				"Mill's own.",
			Status: capabilities.StatusOpen,
			StatusDetail: "KindTrigger + five NodeTypes (manual/hotkey/schedule/clipboard-" +
				"watch/filesystem-watch) built and wired through TriggerService, incl. " +
				"one-combo-per-workflow hotkey exclusivity (§3.4). DOM-event and MCP-call " +
				"triggers remain unbuilt, gated on §5/§3.1's own open questions.",
		},
		{
			ID: "decision", Name: "Decision / branching",
			WhatItDoes: "Route execution down one of several named output edges based on a " +
				"condition evaluated against the running payload.",
			Approach: ApproachMixed,
			ApproachDetail: "Node/graph semantics: build (core domain). Expression evaluation " +
				"underneath: adopt (expr-lang/expr, MIT, sandboxed/side-effect-free by design).",
			Status:       capabilities.StatusOpen,
			StatusDetail: "ADR-0005 names it, deferred. The Edge.SourceHandle field the canvas now persists is reserved for this.",
		},
		{
			ID: "parallel-steps", Name: "Parallel Steps",
			WhatItDoes: "Fan out to multiple steps concurrently, then join.",
			Approach:   ApproachMixed,
			ApproachDetail: "Graph/fan-in semantics: build. Concurrency execution: DBOS's " +
				"Queue/WithWorkerConcurrency (§7) is a plausible real backing mechanism once " +
				"designed, not hand-rolled goroutine management.",
			Status:       capabilities.StatusOpen,
			StatusDetail: "ADR-0005 names it, deferred.",
		},
		{
			ID: "child-workflow", Name: "Child Workflow",
			WhatItDoes:     "One workflow invokes another as a step.",
			Approach:       ApproachBuild,
			ApproachDetail: "Composition rule -- no library has an opinion on Mill's own workflow-of-workflows semantics.",
			Status:         capabilities.StatusOpen,
			StatusDetail:   "ADR-0005 names it, deferred.",
		},
		{
			ID: "connector", Name: "Integration / Connector node",
			WhatItDoes: "Call an external HTTP API, auth'd.",
			Approach:   ApproachMixed,
			ApproachDetail: "Wire protocol: adopt (stdlib net/http, or MCP per §3.1 if exposed " +
				"as a tool). Connector config/credential model: build.",
			Status:       capabilities.StatusOpen,
			StatusDetail: "§4, open.",
		},
		{
			ID: "durable-execution", Name: "Durable step execution / retry / resume",
			WhatItDoes:     "Survive the process dying mid-workflow, checkpoint per step, retry transient failures.",
			Approach:       ApproachAdopt,
			ApproachDetail: "DBOS-Go.",
			Status:         capabilities.StatusOpen,
			StatusDetail:   "ADR-0004, proposed -- integration paused pending this UI-first pass.",
		},
		{
			ID: "replay", Name: "Replay / re-run from history",
			WhatItDoes:     "Re-invoke a past run, ideally resuming rather than restarting.",
			Approach:       ApproachMixed,
			ApproachDetail: "Mechanism: adopt (DBOS ForkWorkflow/workflow-ID resume). UI/policy: build.",
			Status:         capabilities.StatusOpen,
			StatusDetail:   "Named, not built.",
		},
		{
			ID: "versioning", Name: "Draft/live versioning",
			WhatItDoes:     "Edit a workflow without breaking the currently-live version.",
			Approach:       ApproachBuild,
			ApproachDetail: "No library owns Mill's own versioning semantics.",
			Status:         capabilities.StatusOpen,
			StatusDetail:   "Real gap flagged from the reference-platform review (§3.2).",
		},
		{
			ID: "shadow-events", Name: "Live + shadow events / execution history",
			WhatItDoes:     "Filterable log of past runs; dry-run a candidate change against real traffic before trusting it.",
			Approach:       ApproachMixed,
			ApproachDetail: "Data: adopt (DBOS GetStatus/ListWorkflows). UI: build.",
			Status:         capabilities.StatusOpen,
			StatusDetail:   "§3.2 shadow-events bullet; §7 already calls Activity \"the closest thing to the analytics half.\"",
		},
		{
			ID: "guardrail-preview", Name: "Guardrail preview / policy gate",
			WhatItDoes:     "Approve/deny before a step actually runs.",
			Approach:       ApproachBuild,
			ApproachDetail: "Core domain -- no library has an opinion on Mill's guardrail semantics.",
			Status:         capabilities.StatusOpen,
			StatusDetail:   "§8, locked in shape, open in detail.",
		},
		{
			ID: "visual-composition", Name: "Visual composition surface",
			WhatItDoes: "Author a DAG, not just a list.",
			Approach:   ApproachAdopt,
			ApproachDetail: "React Flow / @xyflow/react, adopted -- built ahead of ADR-0005 " +
				"B2's original \"2+ real multi-step workflows\" deferral trigger, by explicit " +
				"decision (see the ADR's Update section).",
			Status: capabilities.StatusOpen,
			StatusDetail: "§3 -- canvas built and real (drag-and-drop, undo/redo, auto-layout), " +
				"still UX: PROTOTYPE, not the final authoring surface.",
		},
	}
}
