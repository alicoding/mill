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

// NodeKind mirrors SPEC.md §2's Capture -> Process -> Apply primitive,
// plus Trigger (SPEC.md §3.4) and Decision (SPEC.md §3.5) -- Decision is
// the one kind allowed more than one outgoing edge (see walk/nextNode).
// Parallel/Child Workflow stay real future work, not stubbed here
// speculatively.
type NodeKind string

const (
	KindTrigger  NodeKind = "trigger"
	KindCapture  NodeKind = "capture"
	KindProcess  NodeKind = "process"
	KindApply    NodeKind = "apply"
	KindDecision NodeKind = "decision"
)

// ConfigFieldType is the field's UI/value shape -- modeled on n8n's own
// node-parameter taxonomy (docs.n8n.io, see docs/SPEC.md §3.4), narrowed
// to the subset Mill actually needs today. n8n's fuller set (collection,
// fixedCollection, resourceLocator, ...) maps to Mill's own not-yet-built
// Decision/Parallel nodes -- not stubbed here ahead of that need, same
// discipline as NodeKind's own comment above.
type ConfigFieldType string

const (
	FieldText    ConfigFieldType = "text"
	FieldNumber  ConfigFieldType = "number"
	FieldBoolean ConfigFieldType = "boolean"
	FieldOptions ConfigFieldType = "options"
)

// ConfigField declares one configurable parameter a node type's nodes
// can set. A node type with no ConfigFields takes no parameters --
// legitimately true for some nodes (capture/process here operate on
// whatever's piped in, every Trigger node type today), not a placeholder
// to fill in later.
type ConfigField struct {
	Key         string
	Label       string
	Description string
	Default     string
	Type        ConfigFieldType
	// Options is only meaningful when Type == FieldOptions -- the set of
	// values ResolveNodeDefaults will accept for this field.
	Options []string
	// RefKind marks a FieldText field whose value is the ID of a
	// Configure-authored entity ("request" | "list" | "mcpserver"),
	// empty for an ordinary text field (docs/adr/0009). Orthogonal to
	// Type: the wire value is still a plain string ID (Type stays
	// FieldText), RefKind only tells the frontend Inspector which
	// Configure list to offer as a live picker instead of a bare text
	// box. composition itself never reads RefKind -- nodeExec functions
	// still just read the plain string ID out of Node.Config.
	RefKind string
	// Suggestions is only meaningful when Type == FieldText -- unlike
	// Options (FieldOptions' closed enum), any value is still accepted;
	// these are offered as autocomplete hints only (an HTML5 datalist on
	// the frontend). ADR-0016: the open-vs-closed distinction this field
	// exists for was decided directly against real precedent -- Bruno's
	// own .bru format offers named HTTP methods but keeps an explicit
	// `method: CUSTOM` escape hatch rather than a closed enum, since a
	// closed list can't express a new or uncommon method (e.g. RFC
	// 10008's QUERY, published June 2026) without a code change.
	Suggestions []string
}

type NodeType struct {
	ID           string
	Kind         NodeKind
	Label        string
	Description  string
	ConfigFields []ConfigField
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
// unlike a reusable HTTPRequest or List. Reuses ConfigFieldType rather
// than inventing a second type enum -- a workflow's attribute schema and
// a node's config fields are the same kind of "name + typed value"
// declaration.
type AttributeDef struct {
	Key   string
	Label string
	Type  ConfigFieldType
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
	// Attributes is this workflow's declared structured-field schema --
	// what a Decision node's rule builder offers as available fields, and
	// what a generated test payload (§3.4) can seed. Does not itself
	// carry values; ExecContext.Attributes does, at run time.
	Attributes []AttributeDef
	// BuiltIn marks a seeded, non-deletable workflow (the two shipped
	// with this prototype) vs. one a user composed and that persisted --
	// the UI badges/protects built-ins accordingly.
	BuiltIn bool
	// Lifecycle & versioning (docs/adr/0021, versioning.go). The head
	// fields above are the DRAFT; Versions are immutable snapshots;
	// PublishedVersion (0 = never published) is what triggers and
	// child-workflow calls execute. Disabled -- not Active -- so every
	// workflow persisted before this field existed unmarshals as
	// active, migration-free (JSON zero value).
	Disabled         bool
	PublishedVersion int
	Versions         []WorkflowVersion
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
}
