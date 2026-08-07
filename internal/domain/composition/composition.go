// Package composition is a prototype for SPEC.md §3 (capability
// composition), testing ADR-0005's node/workflow shape against real,
// working code rather than a mockup -- see docs/SPEC.md's `UX: PROTOTYPE`
// entry under §3. It is additive: internal/domain/runbook is untouched,
// still the tested/tuned path for load-sample-html and clipboard-html-
// to-markdown. This package's node primitives call the *same* adapter
// functions runbook.go calls, decomposed into reusable Capture/Process/
// Apply steps (§2's already-locked core primitive) and recomposed into
// workflows -- the same real capability, not a fictional example.
//
// Composing a workflow is inseparable from configuring it: a step is
// never just "a reference to a node type" -- it always carries fully
// resolved configuration values (see ResolveStepDefaults), even when
// those values are just each field's default. There is no such thing as
// an unconfigured step.
package composition

import (
	"fmt"

	"github.com/alicoding/mill/internal/adapters/clipboard"
	"github.com/alicoding/mill/internal/adapters/markdown"
	"github.com/alicoding/mill/internal/domain/capabilities"
)

// Package-level function vars, not direct calls -- same testability
// pattern as internal/domain/runbook.
var (
	readClipboardHTML  = clipboard.ReadHTML
	writeClipboardHTML = clipboard.WriteHTML
	writeClipboardText = clipboard.WriteText
	htmlToMarkdown     = markdown.ToMarkdown
)

// NodeKind mirrors SPEC.md §2's Capture -> Process -> Apply primitive --
// today's node types are drawn from that already-locked shape rather
// than the fuller Ruleset/Decision/... taxonomy ADR-0005 surveys, since
// only Capture/Process/Apply nodes exist as real code yet. Control-flow
// node kinds (Decision, Parallel, Child Workflow) stay real future work,
// not stubbed here speculatively.
type NodeKind string

const (
	KindCapture NodeKind = "capture"
	KindProcess NodeKind = "process"
	KindApply   NodeKind = "apply"
)

// ConfigField declares one configurable parameter a node type's steps
// can set. A node type with no ConfigFields takes no parameters --
// legitimately true for some nodes (capture/process here operate on
// whatever's piped in), not a placeholder to fill in later.
type ConfigField struct {
	Key         string
	Label       string
	Description string
	Default     string
}

type NodeType struct {
	ID           string
	Kind         NodeKind
	Label        string
	Description  string
	ConfigFields []ConfigField
}

// Step is one configured instance of a node type inside a workflow.
// Config is always fully resolved (every ConfigField's key present) by
// the time a Step is stored or executed -- see ResolveStepDefaults.
// There is deliberately no notion of an unconfigured step: composing
// and configuring happen together, not as separate passes.
type Step struct {
	NodeTypeID string
	Config     map[string]string
}

// Workflow is a flat, ordered pipeline of configured steps -- enough for
// today's real workflows. Branching/parallel composition is real future
// work per ADR-0005, not invented here ahead of a need for it.
type Workflow struct {
	ID          string
	Label       string
	Description string
	Steps       []Step
	// BuiltIn marks a seeded, non-deletable workflow (the two shipped
	// with this prototype) vs. one a user composed and that persisted --
	// the UI badges/protects built-ins accordingly.
	BuiltIn bool
}

// sampleHTML is the default value for apply-clipboard-write-html's
// "html" field -- matches runbook.go's own fixture (duplicated
// deliberately, not imported: it's a demo fixture, not a fact either
// package should depend on the other for).
const sampleHTML = `<h2>Quarterly update</h2>
<p>Here's a quick summary, with <strong>the important bit</strong> called out.</p>
<ul>
  <li>Runbook actions now support global keyboard shortcuts</li>
  <li>Clipboard capture preserves <em>real</em> structure, not flattened text</li>
  <li>The UI now runs on Primer, not hand-rolled CSS</li>
</ul>`

func NodeTypes() []NodeType {
	return []NodeType{
		{
			ID: "capture-clipboard-html", Kind: KindCapture,
			Label:       "Capture: clipboard HTML",
			Description: "Reads whatever HTML is currently on the clipboard.",
		},
		{
			ID: "process-html-to-markdown", Kind: KindProcess,
			Label:       "Process: HTML → Markdown",
			Description: "Converts HTML into Markdown, preserving structure (headings, bold, lists).",
		},
		{
			ID: "apply-clipboard-write-text", Kind: KindApply,
			Label:       "Apply: write plain text to clipboard",
			Description: "Writes the workflow's current payload to the clipboard as plain text.",
		},
		{
			ID: "apply-clipboard-write-html", Kind: KindApply,
			Label:       "Apply: write HTML to clipboard",
			Description: "Writes configured HTML to the clipboard.",
			ConfigFields: []ConfigField{
				{
					Key: "html", Label: "HTML to write",
					Description: "The HTML content this step puts on the clipboard.",
					Default:     sampleHTML,
				},
			},
		},
	}
}

func nodeType(id string) (NodeType, bool) {
	for _, nt := range NodeTypes() {
		if nt.ID == id {
			return nt, true
		}
	}
	return NodeType{}, false
}

// BuiltInWorkflows are the two workflows this prototype ships seeded --
// the same real clipboard/markdown capability internal/domain/runbook
// already ships, decomposed into steps. Not deletable (see
// CompositionService.DeleteWorkflow).
func BuiltInWorkflows() []Workflow {
	loadSample, err := ResolveStepDefaults([]Step{
		{NodeTypeID: "apply-clipboard-write-html"},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}
	clipboardToMarkdown, err := ResolveStepDefaults([]Step{
		{NodeTypeID: "capture-clipboard-html"},
		{NodeTypeID: "process-html-to-markdown"},
		{NodeTypeID: "apply-clipboard-write-text"},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:          "load-sample-html-workflow",
			Label:       "Load sample HTML",
			Description: "A single-step workflow: puts real HTML on the clipboard.",
			Steps:       loadSample,
			BuiltIn:     true,
		},
		{
			ID:          "clipboard-html-to-markdown-workflow",
			Label:       "Clipboard → Markdown",
			Description: "Capture the clipboard's HTML, convert it to Markdown, write it back.",
			Steps:       clipboardToMarkdown,
			BuiltIn:     true,
		},
	}
}

// ResolveStepDefaults validates every step's NodeTypeID against
// NodeTypes() and fills in any missing config key with that field's
// Default, so the returned steps are always fully resolved -- composing
// a workflow always configures it, even implicitly via defaults. Called
// once, when a workflow is created; never lazily at execution time.
func ResolveStepDefaults(steps []Step) ([]Step, error) {
	resolved := make([]Step, len(steps))
	for i, step := range steps {
		nt, ok := nodeType(step.NodeTypeID)
		if !ok {
			return nil, fmt.Errorf("unknown node type: %s", step.NodeTypeID)
		}

		config := make(map[string]string, len(nt.ConfigFields))
		for k, v := range step.Config {
			config[k] = v
		}
		for _, field := range nt.ConfigFields {
			if _, ok := config[field.Key]; !ok {
				config[field.Key] = field.Default
			}
		}
		resolved[i] = Step{NodeTypeID: step.NodeTypeID, Config: config}
	}
	return resolved, nil
}

// nodeExec threads a single string payload from step to step, with each
// step's own resolved Config available -- enough for today's real
// workflows. A richer typed payload is real future work once a node
// needs more than one value, not invented speculatively now.
var nodeExec = map[string]func(step Step, payload string) (string, error){
	"capture-clipboard-html": func(_ Step, _ string) (string, error) {
		return readClipboardHTML()
	},
	"process-html-to-markdown": func(_ Step, html string) (string, error) {
		return htmlToMarkdown(html)
	},
	"apply-clipboard-write-text": func(_ Step, text string) (string, error) {
		if err := writeClipboardText(text); err != nil {
			return "", err
		}
		return text, nil
	},
	"apply-clipboard-write-html": func(step Step, _ string) (string, error) {
		html := step.Config["html"]
		if err := writeClipboardHTML(html); err != nil {
			return "", err
		}
		return html, nil
	},
}

// ExecuteWorkflow runs a fully-resolved step list in order. Errors here
// are plain/technical -- unlike internal/domain/runbook's hand-tuned
// soft-failure copy (e.g. "no HTML found on the clipboard" with a nil
// error), this is a deliberate prototype simplification, not a
// regression: the careful UX still lives in runbook.go, untouched.
func ExecuteWorkflow(steps []Step) (string, error) {
	payload := ""
	for _, step := range steps {
		exec, ok := nodeExec[step.NodeTypeID]
		if !ok {
			return "", fmt.Errorf("unknown node type: %s", step.NodeTypeID)
		}
		out, err := exec(step, payload)
		if err != nil {
			return "", fmt.Errorf("step %s: %w", step.NodeTypeID, err)
		}
		payload = out
	}
	return payload, nil
}

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
				"adapter (hotkey already does); the abstraction unifying them into one node " +
				"kind is Mill's own.",
			Status: capabilities.StatusOpen,
			StatusDetail: "Hotkey mechanism exists (HotkeyService) but isn't modeled as a " +
				"graph node yet.",
		},
		{
			ID: "decision", Name: "Decision / branching",
			WhatItDoes: "Route execution down one of several named output edges based on a " +
				"condition evaluated against the running payload.",
			Approach: ApproachMixed,
			ApproachDetail: "Node/graph semantics: build (core domain). Expression evaluation " +
				"underneath: adopt (expr-lang/expr, MIT, sandboxed/side-effect-free by design).",
			Status:       capabilities.StatusOpen,
			StatusDetail: "ADR-0005 names it, deferred.",
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
			StatusDetail:   "Named this session, not built.",
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
			WhatItDoes:     "Author a DAG, not just a list.",
			Approach:       ApproachAdopt,
			ApproachDetail: "React Flow / @xyflow/react -- but only once real multi-step content exists to design against.",
			Status:         capabilities.StatusOpen,
			StatusDetail:   "§3, deferred (ADR-0005's B2).",
		},
	}
}
