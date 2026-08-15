package composition

// DeclaredStepBinding is the raw, data-backed declaration a Configure-
// tier "Declared step type" entity supplies (ADR-0037 Decision 2).
// composition itself never persists these -- ConfigureService injects
// them via SetDeclaredNodeTypeLookup once wired (main.go), the same
// injected-function-var seam SetHTTPRequestLookup/SetMCPServerLookup/
// SetChildWorkflowLookup already establish (.claude/rules/backend.md).
type DeclaredStepBinding struct {
	ID          string
	Label       string
	Description string
	// PaletteGroup is the declaration's own display-group choice
	// (declaredsteptype.PaletteGroup, one of the closed set frontend/
	// src/composition/paletteGroups.ts's PaletteGroupId establishes) --
	// carried straight through onto the synthesized NodeType's own
	// PaletteGroup field below, unlike every other field here which
	// feeds ConfigFields/exec instead.
	PaletteGroup string
	// EngineNodeTypeID names which already-registered NodeType this
	// declaration delegates to (ADR-0037 Decision 1's "naming-and-
	// binding over an engine that already exists") -- one of
	// "integration-http" | "mcp-tool-call" | "child-workflow" today.
	EngineNodeTypeID string
	// PinnedConfig is applied over the underlying engine's own
	// ConfigFields as each field's new Default -- includes the
	// engine's own binding field (e.g. requestId), which the service
	// layer injects here alongside HiddenFields below so a declared
	// type's authored nodes can never repoint it to a different
	// entity (ADR-0037: "declaration may pin an existing engine's
	// config; it may never introduce new transform semantics").
	PinnedConfig map[string]string
	// HiddenFields names ConfigField keys to drop entirely from the
	// synthesized palette view (still applied from PinnedConfig at
	// exec time, just never author-editable per node) -- always
	// includes the engine's own binding field key(s).
	HiddenFields []string
}

// DeclaredNodeTypeProvider returns every currently-defined declared
// step type binding. A function, not a static slice, so the live
// Configure-authored set is always read fresh at NodeTypes()/exec time
// -- the same "resolved server-side at execution time" shape every
// sibling lookup seam in this package already uses.
type DeclaredNodeTypeProvider func() []DeclaredStepBinding

// declaredNodeTypeLookupFn defaults to returning nothing so composition
// stays executable standalone (every unit test in this package, and
// `go generate ./internal/contract`'s own generator process, which
// never wires ConfigureService at all) -- unlike lookupHTTPRequestFn's
// own default, an empty declared-type set is a legitimate, common
// state (no declared types exist yet), not an error to surface loudly.
var declaredNodeTypeLookupFn DeclaredNodeTypeProvider = func() []DeclaredStepBinding { return nil }

// SetDeclaredNodeTypeLookup wires the function NodeTypes()/execution/
// validation use to resolve declared step types. Called once from
// ConfigureService's constructor once its own declared-step-type store
// is loaded (main.go's construction order: CompositionService before
// ConfigureService -- see builtinworkflows_declaredsteptype.go's own
// doc comment for the one place that ordering is directly visible).
func SetDeclaredNodeTypeLookup(fn DeclaredNodeTypeProvider) {
	if fn == nil {
		fn = func() []DeclaredStepBinding { return nil }
	}
	declaredNodeTypeLookupFn = fn
}

// resolveDeclaredEntry synthesizes a nodeTypeEntry for one declared
// step's binding -- ADR-0037 Decision 2's exact recipe: Label/
// Description/PaletteGroup(via the caller's own NodeType.ID)/Output
// from the declaration and its underlying engine, ConfigFields the
// engine's own fields minus HiddenFields with PinnedConfig applied as
// each remaining field's Default, Effect the underlying engine's
// Effect verbatim (never weakened -- a declaration can only delegate,
// never re-classify), and exec the underlying engine's exec invoked
// against a Node whose Config merges the pinned values over whatever
// the authored node itself carries (pinned always wins, matching
// PinnedConfig's own doc comment). ok=false when EngineNodeTypeID
// isn't a real registered NodeType -- shouldn't happen for real data,
// but the caller treats this exactly like "unknown step type" rather
// than panicking.
func resolveDeclaredEntry(b DeclaredStepBinding) (nodeTypeEntry, bool) {
	engine, ok := nodeTypeRegistry[b.EngineNodeTypeID]
	if !ok {
		return nodeTypeEntry{}, false
	}

	hidden := make(map[string]bool, len(b.HiddenFields))
	for _, k := range b.HiddenFields {
		hidden[k] = true
	}
	fields := make([]ConfigField, 0, len(engine.nodeType.ConfigFields))
	for _, f := range engine.nodeType.ConfigFields {
		if hidden[f.Key] {
			continue
		}
		if pinned, ok := b.PinnedConfig[f.Key]; ok {
			f.Default = pinned
		}
		fields = append(fields, f)
	}

	nt := NodeType{
		ID:           b.ID,
		Kind:         engine.nodeType.Kind,
		Label:        b.Label,
		Description:  b.Description,
		ConfigFields: fields,
		Output:       engine.nodeType.Output,
		Effect:       engine.nodeType.Effect,
		Declared:     true,
		PaletteGroup: b.PaletteGroup,
		// Basic by construction (NodeType.Complexity's own doc comment,
		// docs/goals/0047): a declaration exists specifically to curate
		// the underlying engine's complexity away behind a fixed binding,
		// never to inherit it.
		Complexity: ComplexityBasic,
	}

	exec := func(node Node, ctx ExecContext) (ExecContext, error) {
		merged := make(map[string]string, len(node.Config)+len(b.PinnedConfig))
		for k, v := range node.Config {
			merged[k] = v
		}
		for k, v := range b.PinnedConfig {
			merged[k] = v
		}
		underlying := Node{ID: node.ID, Kind: node.Kind, NodeTypeID: b.EngineNodeTypeID, Config: merged, Position: node.Position}
		return engine.exec(underlying, ctx)
	}

	return nodeTypeEntry{nodeType: nt, exec: exec}, true
}

// lookupNodeTypeEntry is the ONE choke point every call site in this
// package uses to resolve a NodeTypeID to its registry entry --
// compile-time registrations first (the common, fast case, and every
// declared type's own EngineNodeTypeID), falling back to a declared
// step type's synthesized entry (ADR-0037's data-backed registry) only
// when no static entry matches. Replaces the direct
// nodeTypeRegistry[id] reads execute.go/nodetypes.go used before this
// existed, so a declared type resolves identically everywhere: exec
// (execute.go), ResolveNodeDefaults/nodeType (nodetypes.go), effect
// lookup (NodeTypeEffect), and graph validation (nodeType, graph.go).
func lookupNodeTypeEntry(id string) (nodeTypeEntry, bool) {
	if entry, ok := nodeTypeRegistry[id]; ok {
		return entry, true
	}
	for _, b := range declaredNodeTypeLookupFn() {
		if b.ID == id {
			return resolveDeclaredEntry(b)
		}
	}
	return nodeTypeEntry{}, false
}

// declaredNodeTypes returns every currently-resolvable declared step
// type as a synthesized NodeType -- NodeTypes()'s own declared half.
// A binding whose EngineNodeTypeID isn't a real registered NodeType is
// silently skipped (shouldn't happen for real Configure-authored data)
// rather than surfacing a broken catalog entry.
func declaredNodeTypes() []NodeType {
	var out []NodeType
	for _, b := range declaredNodeTypeLookupFn() {
		if entry, ok := resolveDeclaredEntry(b); ok {
			out = append(out, entry.nodeType)
		}
	}
	return out
}
