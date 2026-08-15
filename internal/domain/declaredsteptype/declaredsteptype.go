// Package declaredsteptype holds the core-domain shape of a Declared
// step type (docs/adr/0037, docs/goals/0054 slice A): a reusable
// (1:many), Configure-authored NAME + BINDING over one of Mill's
// already-registered kernel engines (integration-http, mcp-tool-call,
// child-workflow) -- never a new execution engine of its own. Per
// CLAUDE.md's core-domain rule, the shape and its validation stay
// hand-written, mirroring internal/domain/decision's own recipe
// exactly (the structural template ADR-0037's Decision 2 points at).
//
// This package deliberately never imports internal/domain/composition:
// the translation from a DeclaredStepType into composition's own
// DeclaredStepBinding provider shape is a service-layer concern
// (internal/services/configuresvc), the same "domain packages don't
// know about each other's specifics, the service layer bridges them"
// rule integration.go's ResolvedHTTPRequest/SetHTTPRequestLookup seam
// already follows.
package declaredsteptype

import (
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// Engine names which already-registered composition NodeType a
// declaration delegates to (ADR-0037 Decision 1's "naming-and-binding
// over an engine that already exists") -- the exact three engines the
// ADR's own binding fields (requestId/mcpServerId+toolName/workflowId)
// correspond to. A step type requiring a fourth engine needs a new
// kernel-registered NodeType first (ADR-0035); it can never be
// expressed as a fourth Engine value here.
type Engine string

const (
	EngineHTTP     Engine = "http"
	EngineMCP      Engine = "mcp"
	EngineWorkflow Engine = "workflow"
)

func validEngine(e Engine) bool {
	switch e {
	case EngineHTTP, EngineMCP, EngineWorkflow:
		return true
	}
	return false
}

// PaletteGroup is this declaration's display-group hint -- the closed
// set frontend/src/composition/paletteGroups.ts's PaletteGroupId
// already establishes for every built-in NodeType. Must stay in sync
// with that TS union by hand (there is no generated-binding link
// between them, the same direction of drift paletteGroups.ts's own
// NODE_TYPE_GROUP map already carries in reverse, guarded there by
// paletteGroups.test.ts).
type PaletteGroup string

const (
	GroupTriggers   PaletteGroup = "triggers"
	GroupCapture    PaletteGroup = "capture"
	GroupTransform  PaletteGroup = "transform"
	GroupAI         PaletteGroup = "ai"
	GroupData       PaletteGroup = "data"
	GroupActions    PaletteGroup = "actions"
	GroupFlow       PaletteGroup = "flow"
	GroupGuardrails PaletteGroup = "guardrails"
	GroupApply      PaletteGroup = "apply"
)

var validPaletteGroups = map[PaletteGroup]bool{
	GroupTriggers: true, GroupCapture: true, GroupTransform: true, GroupAI: true,
	GroupData: true, GroupActions: true, GroupFlow: true, GroupGuardrails: true, GroupApply: true,
}

// DeclaredStepType is one reusable, Configure-authored named step type
// (ADR-0037): a palette presentation (Label/Description/PaletteGroup)
// bound to exactly one existing engine's operation, plus optional
// pinned config values and hidden fields applied over that engine's
// own ConfigFields. Exactly one of RequestID / (MCPServerID+ToolName)
// / WorkflowID is set, matching Engine -- Validate enforces this.
type DeclaredStepType struct {
	ID           string
	Label        string
	Description  string
	PaletteGroup PaletteGroup

	Engine      Engine
	RequestID   string // set iff Engine == EngineHTTP (RefKind "request")
	MCPServerID string // set iff Engine == EngineMCP (RefKind "mcpserver")
	ToolName    string // set iff Engine == EngineMCP
	WorkflowID  string // set iff Engine == EngineWorkflow (RefKind "workflow")

	// PinnedConfig applies over the underlying engine's ConfigFields as
	// each field's new Default -- e.g. pinning integration-http's
	// "method" so every node dropped from this declared type starts
	// pre-filled, without forcing it into HiddenFields too. Does NOT
	// need to (and should not) carry the engine's own binding field --
	// EngineFields() below supplies that automatically, always both
	// pinned AND hidden, so a declared type's binding can never be
	// repointed per-node (ADR-0037: "declaration may pin an existing
	// engine's config; it may never introduce new transform
	// semantics").
	PinnedConfig map[string]string
	// HiddenFields names additional ConfigField keys (beyond the
	// engine's own binding field, always hidden) to drop entirely from
	// the synthesized palette view -- still applied from PinnedConfig
	// at exec time if present, just never author-editable per node.
	HiddenFields []string

	// BuiltIn marks a seeded, top-up example (builtin.go) -- purely
	// informational, same as decision.Decision.BuiltIn/
	// httprequest.HTTPRequest.BuiltIn.
	BuiltIn bool
	// CreatedAt/UpdatedAt are system-managed audit timestamps (SPEC.md
	// §3.2.2's reserved-column pattern), stamped server-side at every
	// persisted mutation (ConfigureService), never trusted from the
	// wire.
	CreatedAt time.Time
	UpdatedAt time.Time
	// Seed is this declared step type's seed provenance (docs/goals/0037)
	// -- zero value means "not of seed origin," migration-free. See
	// composition.Workflow.Seed's doc comment for the full reasoning.
	Seed seedorigin.Origin
}

// EngineNodeTypeID returns the composition NodeType ID d.Engine
// delegates to -- a hardcoded 1:1 mapping (not imported from
// composition, which declares no exported ID constants for these
// three engines; this package cannot import composition anyway, see
// this file's own package doc comment) -- empty for an invalid Engine.
func (d DeclaredStepType) EngineNodeTypeID() string {
	switch d.Engine {
	case EngineHTTP:
		return "integration-http"
	case EngineMCP:
		return "mcp-tool-call"
	case EngineWorkflow:
		return "child-workflow"
	}
	return ""
}

// EngineFields returns the underlying engine's own binding ConfigField
// key(s) and their bound value(s) -- e.g. {"requestId": d.RequestID}
// for EngineHTTP. The service layer that converts a DeclaredStepType
// into composition's DeclaredStepBinding merges these into BOTH
// PinnedConfig and HiddenFields, which is what keeps the binding fixed
// rather than merely defaulted (this file's own PinnedConfig doc
// comment). Empty for an invalid Engine.
func (d DeclaredStepType) EngineFields() map[string]string {
	switch d.Engine {
	case EngineHTTP:
		return map[string]string{"requestId": d.RequestID}
	case EngineMCP:
		return map[string]string{"mcpServerId": d.MCPServerID, "toolName": d.ToolName}
	case EngineWorkflow:
		return map[string]string{"workflowId": d.WorkflowID}
	}
	return nil
}

// Validate checks a DeclaredStepType is well-formed before it's
// persisted -- same "never store an unconfigured/invalid value"
// discipline every other Configure-authored entity's Validate already
// applies (see internal/domain/decision.Validate).
func Validate(d DeclaredStepType) error {
	if strings.TrimSpace(d.Label) == "" {
		return fmt.Errorf("a declared step type needs a label")
	}
	if !validPaletteGroups[d.PaletteGroup] {
		return fmt.Errorf("a declared step type needs a valid palette group (got %q)", d.PaletteGroup)
	}
	if !validEngine(d.Engine) {
		return fmt.Errorf("a declared step type needs a valid engine (got %q)", d.Engine)
	}

	// Exactly one of RequestID / (MCPServerID+ToolName) / WorkflowID may
	// be set, and it must match Engine -- ADR-0037's "exactly one of
	// requestId/mcpServerId+tool name/workflowId" binding rule.
	switch d.Engine {
	case EngineHTTP:
		if strings.TrimSpace(d.RequestID) == "" {
			return fmt.Errorf("an http-engine declared step type needs a requestId")
		}
		if d.MCPServerID != "" || d.ToolName != "" || d.WorkflowID != "" {
			return fmt.Errorf("an http-engine declared step type must not set mcpServerId/toolName/workflowId")
		}
	case EngineMCP:
		if strings.TrimSpace(d.MCPServerID) == "" || strings.TrimSpace(d.ToolName) == "" {
			return fmt.Errorf("an mcp-engine declared step type needs both mcpServerId and toolName")
		}
		if d.RequestID != "" || d.WorkflowID != "" {
			return fmt.Errorf("an mcp-engine declared step type must not set requestId/workflowId")
		}
	case EngineWorkflow:
		if strings.TrimSpace(d.WorkflowID) == "" {
			return fmt.Errorf("a workflow-engine declared step type needs a workflowId")
		}
		if d.RequestID != "" || d.MCPServerID != "" || d.ToolName != "" {
			return fmt.Errorf("a workflow-engine declared step type must not set requestId/mcpServerId/toolName")
		}
	}
	return nil
}
