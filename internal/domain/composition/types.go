// Package composition is a prototype for SPEC.md §3 (capability
// composition), testing ADR-0005's node/workflow shape against real,
// working code rather than a mockup -- see docs/SPEC.md's `UX: PROTOTYPE`
// entry under §3. internal/domain/runbook (the original, separate
// Runbook page) has since been retired in favor of this package, per
// SPEC.md §2.2's Update note -- its two actions now live on as ordinary,
// fully-editable seeded workflows (BuiltInWorkflows below), the same
// real capability restated here, not a fictional example.
//
// Composing a workflow is inseparable from configuring it: a node is
// never just "a reference to a node type" -- it always carries fully
// resolved configuration values (see ResolveNodeDefaults), even when
// those values are just each field's default. There is no such thing as
// an unconfigured node.
//
// Workflow.Nodes + Workflow.Edges (rather than a flat ordered Step list)
// is the schema direction docs/SPEC.md §3.3 wrote down before this was
// built, matching React Flow's own {id, type, data, position} node shape
// -- adopted here as ADR-0005 B2's canvas deferral was explicitly
// overridden (see docs/adr/0005-capability-composition-node-schema.md's
// Update section) ahead of its original "2+ real multi-step workflows"
// trigger.
//
// This file holds the package's core types. The rest of the package is
// split by concern across sibling files: nodetypes.go (node-type
// registry, built-in workflows, config resolution), graph.go (graph
// algorithms), integration.go (request-lookup seam), execute.go
// (execution engine), and capabilitymap.go (the §3.3 capability map).
package composition

import (
	"time"

	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// NodeKind mirrors SPEC.md §2's Capture -> Process -> Apply primitive,
// plus Trigger (SPEC.md §3.4), Decision (routing -- ADR-0027 relabels
// its UI vocabulary "Branch", the code identifier KindDecision stays,
// same code-vs-UI split ADR-0016 already established) and Terminal
// (ADR-0027 -- a reusable, typed TERMINAL outcome; "Decision" as a
// user-facing noun now means THIS kind, not the routing one). Terminal
// is the one kind with no outgoing edge at all (ValidateGraph/
// isValidConnection reject one); Decision stays the one kind allowed
// more than one outgoing edge (see walk/nextNode). Parallel/Child
// Workflow stay real future work, not stubbed here speculatively.
type NodeKind string

const (
	KindTrigger  NodeKind = "trigger"
	KindCapture  NodeKind = "capture"
	KindProcess  NodeKind = "process"
	KindApply    NodeKind = "apply"
	KindDecision NodeKind = "decision"
	KindTerminal NodeKind = "terminal"
)

// ConfigFieldType is the field's UI/value shape -- modeled on n8n's own
// node-parameter taxonomy (docs.n8n.io, see docs/SPEC.md §3.4), narrowed
// to the subset Mill actually needs today. n8n's fuller set (collection,
// fixedCollection, resourceLocator, ...) maps to Mill's own not-yet-built
// Decision/Parallel nodes -- not stubbed here ahead of that need, same
// discipline as NodeKind's own comment above.
//
// A type alias of typedfield.Type (docs/adr/0029, Phase 1): the
// canonical leaf type lives in internal/domain/typedfield so
// composition/decision/list can all converge onto one "name + typed
// value" declaration without an import cycle (typedfield has zero
// internal imports; composition already imports decision, so the
// canonical type can't live inside composition itself). ConfigFieldType
// stays a real, separately-named type here -- not just a bare
// typedfield.Type reference at every call site -- so every existing Go
// and generated-TS reference to composition.ConfigFieldType/FieldText
// keeps resolving unchanged; only the underlying representation moved.
type ConfigFieldType = typedfield.Type

const (
	FieldText    = typedfield.TypeText
	FieldNumber  = typedfield.TypeNumber
	FieldBoolean = typedfield.TypeBoolean
	FieldOptions = typedfield.TypeOptions
)

// ConfigField declares one configurable parameter a node type's nodes
// can set. A node type with no ConfigFields takes no parameters --
// legitimately true for some nodes (capture/process here operate on
// whatever's piped in, every Trigger node type today), not a placeholder
// to fill in later.
//
// A type alias of typedfield.Field (docs/adr/0029, Phase 1) -- zero
// wire migration, since encoding/json unmarshals an already-persisted
// {Key,Label,Description,Default,Type,Options,RefKind,Multiline,
// Suggestions} document into the wider struct unchanged (absent fields
// -- Required/Secret/SystemManaged -- fill their Go zero value). See
// typedfield.Field's own doc comment for what each field means;
// RefKind/Multiline/Suggestions below restate composition's own usage
// of them, not a second definition.
//
// RefKind marks a FieldText field whose value is the ID of a
// Configure-authored entity ("request" | "list" | "mcpserver"), empty
// for an ordinary text field (docs/adr/0009). Orthogonal to Type: the
// wire value is still a plain string ID (Type stays FieldText), RefKind
// only tells the frontend Inspector which Configure list to offer as a
// live picker instead of a bare text box. composition itself never
// reads RefKind -- nodeExec functions still just read the plain string
// ID out of Node.Config.
//
// Multiline marks a FieldText whose values are naturally multi-line
// documents (an HTML payload, a JSON arguments object) -- the Inspector
// renders a textarea for these and a single-line input for everything
// else (a key name, a cron string, a path). Added after a direct UI
// critique: every text field rendering as a 4-row textarea was a
// systemic spacing problem, not a per-field choice.
//
// Suggestions is only meaningful when Type == FieldText -- unlike
// Options (FieldOptions' closed enum), any value is still accepted;
// these are offered as autocomplete hints only (an HTML5 datalist on
// the frontend). ADR-0016: the open-vs-closed distinction this field
// exists for was decided directly against real precedent -- Bruno's own
// .bru format offers named HTTP methods but keeps an explicit
// `method: CUSTOM` escape hatch rather than a closed enum, since a
// closed list can't express a new or uncommon method (e.g. RFC 10008's
// QUERY, published June 2026) without a code change.
type ConfigField = typedfield.Field

type NodeType struct {
	ID           string
	Kind         NodeKind
	Label        string
	Description  string
	ConfigFields []ConfigField
	// Output names what payload leaves this step (e.g. "HTML from the
	// clipboard", "Markdown text") -- rendered on the canvas card so
	// the data contract between steps is visible at authoring time
	// (docs/SPEC.md §3.8's authoring-style direction, from the
	// reference prototype's own `Output TypedPayload<...>` card line).
	// Empty for entry points that only start the run.
	Output string
	// Consumes/Produces are the step I/O contract (ADR-0042): the
	// coarse payload kinds this step reads and emits, machine-checked
	// by TestNodeTypes (node-standard item 10 -- no registration may
	// leave them at the zero value) and enforced as edge-compatibility
	// issues by ValidateGraph (payloadkind.go). Output above stays the
	// human display copy; these fields are the contract.
	Consumes []PayloadKind
	Produces PayloadProduce
	// Effect is the node type's side-effect classification
	// (docs/adr/0022's purity model): what the guardrail gate uses to
	// pick a default verdict when no rule matches, and what ADR-0021's
	// deferred shadow evaluation was blocked on. The zero value means
	// ClassNone -- only node types with real I/O declare one.
	Effect guardrail.EffectClass
	// Declared marks a data-backed step type synthesized from a
	// Configure-authored declaration (ADR-0037, declaredsteptype.go)
	// rather than a compile-time RegisterNodeType entry. False (the Go
	// zero value) for every built-in, so every existing serialized
	// catalog/contract document is unaffected until a declared type
	// actually exists -- additive, per ADR-0036's schema-evolution rule.
	Declared bool
	// PaletteGroup is the frontend display-group id (composition/
	// paletteGroups.ts's PaletteGroupId) a declared step type was
	// authored under -- empty for every built-in, whose group instead
	// comes from paletteGroups.ts's own compile-time NODE_TYPE_GROUP map.
	// A declared type has no compile-time map entry (it doesn't exist
	// until a user creates it), so this is the only channel carrying its
	// author-chosen group from the Configure-authored DeclaredStepType
	// (ADR-0037) into the palette at all.
	PaletteGroup string
	// Complexity is the node type's audience/complexity facet
	// (docs/goals/0047): required for every registered NodeType
	// (TestNodeTypes enforces it, the zero value is invalid, never a
	// silent default). ComplexityBasic needs only plain values to
	// configure correctly; ComplexityAdvanced needs either an external
	// system's own documentation (integration-http's API contract,
	// mcp-tool-call's tool schema) or writing code/JSON/expressions
	// (code-execution's script, ruleset's rule conditions, list-search's
	// match-parameter JSON, child-workflow's attribute bindings). Every
	// declared step type is ComplexityBasic by construction
	// (resolveDeclaredEntry, declaredsteptype.go) -- a declaration exists
	// specifically to curate an advanced engine's complexity away behind
	// a fixed binding, so its synthesized palette entry never inherits
	// the underlying engine's own Complexity.
	Complexity Complexity
}

// Complexity is NodeType's audience/complexity facet -- see NodeType's
// own doc comment for the classification rule and
// docs/goals/0047-node-audience-facet.md for the researched precedent
// (progressive disclosure over an audience label, which ages badly).
type Complexity string

const (
	ComplexityBasic    Complexity = "basic"
	ComplexityAdvanced Complexity = "advanced"
)

// ValidComplexity reports whether c is one of the two declared
// Complexity values -- the zero value ("") and any other string are
// both invalid, exercised directly by nodetypes_test.go's own
// TestValidComplexity and, for every registered NodeType, by
// TestNodeTypes.
func ValidComplexity(c Complexity) bool {
	switch c {
	case ComplexityBasic, ComplexityAdvanced:
		return true
	}
	return false
}

// Position is a node's canvas coordinates. Ignored by execution entirely
// -- it exists purely for the React Flow canvas to restore a workflow's
// layout, matching React Flow's own node shape.
type Position struct {
	X float64
	Y float64
}

// Node is one configured instance of a node type inside a workflow's
// graph. Config is always fully resolved (every ConfigField's key
// present) by the time a Node is stored or executed -- see
// ResolveNodeDefaults. Kind is always derived server-side from
// NodeTypeID (never trusted from the client), so it can't drift out of
// sync with the node type it names.
type Node struct {
	ID         string
	Kind       NodeKind
	NodeTypeID string
	Config     map[string]string
	Position   Position
}

// Edge connects one Node's output to another's input by ID. SourceHandle
// is a Decision node's named branch: a real expr-lang/expr expression
// string (e.g. "Attributes.count > 5"), evaluated in order, first match
// wins; exactly one outgoing edge per Decision node must carry the
// literal otherwiseHandle value as the required fallback. Empty for
// every non-Decision edge, since no other node kind branches.
type Edge struct {
	ID           string
	Source       string
	SourceHandle string
	Target       string
}

// AttributeDef declares one named, typed field in a workflow's
// structured Attributes bag (see ExecContext) -- Configure-authored
// (SPEC.md §3.5: "Input/Attributes... you would not tightly couple it in
// the workflow"), but scoped to the one workflow that declares it (1:1),
// unlike a reusable HTTPRequest or List.
//
// A type alias of typedfield.Field, same as ConfigField above
// (docs/adr/0029, Phase 1) -- zero wire migration (an already-persisted
// {Key,Label,Type} document unmarshals into the wider struct unchanged,
// every other field its Go zero value). This is Phase 1's actual
// payoff: AttributeDef immediately gains Options/Required/Default/
// Description/Suggestions/RefKind/Multiline/Secret/SystemManaged for
// free, closing the "AttributeDef carries no Options list" gap
// ruleTranslate.ts's own comment previously named -- no UI wiring
// changed by this alone, only the Go (and generated-TS) shape.
type AttributeDef = typedfield.Field

// NoteColor is a note's optional background tint, drawn from a small
// fixed set -- n8n's own sticky-note precedent (docs/goals/0055's
// research: a small named palette, not an open-ended color picker, is
// what converged in practice). The empty value is the neutral default.
type NoteColor string

const (
	NoteColorDefault NoteColor = ""
	NoteColorYellow  NoteColor = "yellow"
	NoteColorBlue    NoteColor = "blue"
	NoteColorGreen   NoteColor = "green"
	NoteColorPink    NoteColor = "pink"
)

// Size is a note's canvas dimensions. Zero value means "never
// resized" -- the canvas falls back to its own default box.
type Size struct {
	Width  float64
	Height float64
}

// Note is a free-floating authoring-space annotation on a workflow's
// canvas (docs/goals/0055, n8n's "sticky note" precedent) -- explicitly
// NOT a step: no Kind, no NodeTypeID, no ports, no outgoing/incoming
// Edge, never touched by ValidateGraph/ExecuteWorkflow/the guardrail
// gate (those only ever take Nodes/Edges as parameters, never Notes --
// see note_test.go). A workflow's Notes exist purely to document itself
// for whoever opens the canvas next.
type Note struct {
	ID       string
	Text     string
	Position Position
	Size     Size
	Color    NoteColor
}

// Workflow is a node/edge graph. Branching exists now (Decision nodes,
// see walk/nextNode) but is still constrained: every non-Decision node
// keeps at most one outgoing edge, so "graph" in practice means "a chain
// with Decision forks," not an arbitrary DAG.
type Workflow struct {
	ID          string
	Label       string
	Description string
	Nodes       []Node
	Edges       []Edge
	// Notes are free-floating authoring-space annotations -- NOT steps
	// (see Note's own doc comment). Never read by ValidateGraph,
	// ExecuteWorkflow, or anything execution-adjacent.
	Notes []Note
	// Attributes is this workflow's declared structured-field schema --
	// what a Decision node's rule builder offers as available fields, and
	// what a generated test payload (§3.4) can seed. Does not itself
	// carry values; ExecContext.Attributes does, at run time.
	Attributes []AttributeDef
	// BuiltIn marks a seeded, non-deletable workflow (the two shipped
	// with this prototype) vs. one a user composed and that persisted --
	// the UI badges/protects built-ins accordingly.
	BuiltIn bool
	// CreatedAt/UpdatedAt are system-managed audit timestamps (SPEC.md
	// §3.2.2's reserved-column pattern -- "system-managed audit
	// columns... reserved, platform-owned, never user-removable"),
	// stamped server-side at every persisted mutation (compositionsvc),
	// never trusted from the wire. Zero value means pre-timestamp data
	// (persisted before this field existed) -- migration-free, and
	// inventory sort treats a zero CreatedAt/UpdatedAt as "unstamped,
	// sorts last" (frontend/src/shared/inventorySort.ts).
	CreatedAt time.Time
	UpdatedAt time.Time
	// Lifecycle & versioning (docs/adr/0021, versioning.go). The head
	// fields above are the DRAFT; Versions are immutable snapshots;
	// PublishedVersion (0 = never published) is what triggers and
	// child-workflow calls execute. Disabled -- not Active -- so every
	// workflow persisted before this field existed unmarshals as
	// active, migration-free (JSON zero value).
	Disabled         bool
	PublishedVersion int
	Versions         []WorkflowVersion
	// Seed is this workflow's seed provenance (docs/goals/0037):
	// zero value (SeedRevision 0) means "not of seed origin" --
	// migration-free for every workflow persisted before this field
	// existed, same discipline Disabled/PublishedVersion's own doc
	// comments already apply. Platform-owned, stamped only by
	// CompositionService's reconcile/reset/mutation-choke-point logic,
	// never accepted from the wire.
	Seed seedorigin.Origin
	// OfferOnRequestID declares this workflow as an offered action on
	// Atlas cards whose Source URL host matches the named Integration
	// (HTTPRequest) entity's base-URL host (goal 0126: recognition is
	// a host match against configuration the user already did, never a
	// separate pattern registry). Empty = not offered anywhere.
	// Explicit and inspectable by design -- a workflow is offered only
	// because its author declared it, never inferred from its steps.
	// omitempty: an offer-less workflow's JSON stays byte-identical to
	// pre-field data, so persisted stores and the committed seed
	// fingerprints (seeding/seed_fingerprints.json) are untouched by
	// the field's existence.
	OfferOnRequestID string `json:"OfferOnRequestID,omitempty"`
}

// ExecContext threads through a workflow's execution. Payload is the
// existing single-string artifact every Capture/Process/Apply node
// already reads/writes, unchanged in shape; Attributes is new -- a
// separate, structured bag Decision rules evaluate against, populated by
// nodes that choose to write to it (e.g. a future list-lookup or
// integration-http node) rather than by restructuring Payload itself,
// which would have touched every existing node's logic for a need only
// Decision has today.
type ExecContext struct {
	Payload    string
	Attributes map[string]any
	// RunContext is an opaque, caller-supplied per-run context threaded
	// through every node's exec call (docs/adr/0010) -- composition
	// itself never inspects it, only carries it, so a durable caller
	// (executionservice.go) can thread its own DBOS execution.Context
	// through to a child-workflow node without composition importing
	// DBOS (domain purity, .claude/rules/backend.md). nil for any
	// caller that has no such context (every existing unit test,
	// ExecuteWorkflow's own test-only primitive use).
	RunContext any
	// Stepped marks this run as a debug "step mode" session
	// (docs/adr/0031 §5): the guardrail gate parks before EVERY node,
	// not just external-effect ones, until a "Continue" resume clears
	// it. Seeded once from ExecuteOptions.Stepped at the root ExecContext
	// and carried forward untouched by every node's own exec function
	// (they mutate-and-return the same struct, never reconstruct one
	// from scratch) -- only the guardrail gate itself ever flips it back
	// to false, on an explicit Continue.
	Stepped bool
	// WorkflowID is opts.WorkflowID, carried onto the root ExecContext the
	// same way RunContext/Stepped are (docs/goals/0087): a node's own exec
	// function needs it to name itself in cross-service bookkeeping keyed
	// by workflow (the file-move/file-write structural cycle guard,
	// composition.SetFileWriteRecorder) without composition importing the
	// service that owns that bookkeeping. Empty for any caller that
	// supplies no WorkflowID (every existing unit test, ExecuteWorkflow's
	// own test-only primitive use) -- the guard simply never matches an
	// empty workflow id.
	WorkflowID string
}
