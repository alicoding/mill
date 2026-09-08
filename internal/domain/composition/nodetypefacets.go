package composition

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

// PaletteGroup is NodeType's frontend display-group facet -- see
// NodeType.PaletteGroup's own doc comment. The 10 values below are
// exactly frontend/src/shared/paletteGroups.ts's PaletteGroupId union;
// the two lists are meant to stay identical, never independently
// extended (a new group needs a matching frontend PALETTE_GROUP_ORDER
// entry, and vice versa).
type PaletteGroup string

const (
	PaletteGroupTriggers   PaletteGroup = "triggers"
	PaletteGroupCapture    PaletteGroup = "capture"
	PaletteGroupTransform  PaletteGroup = "transform"
	PaletteGroupAI         PaletteGroup = "ai"
	PaletteGroupData       PaletteGroup = "data"
	PaletteGroupActions    PaletteGroup = "actions"
	PaletteGroupBrowser    PaletteGroup = "browser"
	PaletteGroupFlow       PaletteGroup = "flow"
	PaletteGroupGuardrails PaletteGroup = "guardrails"
	PaletteGroupApply      PaletteGroup = "apply"
)

// ValidPaletteGroup reports whether g is one of the 10 declared groups
// -- the zero value ("") and any other string are both invalid,
// exercised directly by nodetypes_test.go's own TestValidPaletteGroup
// and, for every registered NodeType, by TestNodeTypes.
func ValidPaletteGroup(g PaletteGroup) bool {
	switch g {
	case PaletteGroupTriggers, PaletteGroupCapture, PaletteGroupTransform, PaletteGroupAI, PaletteGroupData,
		PaletteGroupActions, PaletteGroupBrowser, PaletteGroupFlow, PaletteGroupGuardrails, PaletteGroupApply:
		return true
	}
	return false
}
