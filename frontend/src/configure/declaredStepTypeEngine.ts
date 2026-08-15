import { Engine } from '../../bindings/github.com/alicoding/mill/internal/domain/declaredsteptype/models'

// Mirrors declaredsteptype.DeclaredStepType's own EngineNodeTypeID()/
// EngineFields() (internal/domain/declaredsteptype/declaredsteptype.go)
// exactly -- there is no generated-binding link between a Go method and
// a TS function, so this pair is kept in sync by hand, the same
// direction of drift composition/paletteGroups.ts's own NODE_TYPE_GROUP
// map already carries for a different field. Used by the step-designer
// form to know which existing NodeType's ConfigFields to offer for
// pinning, and which of those fields are the engine's own binding
// (always force-hidden, never offered as pinnable).

export function engineNodeTypeIdFor(engine: Engine): string {
  switch (engine) {
    case Engine.EngineHTTP: return 'integration-http'
    case Engine.EngineMCP: return 'mcp-tool-call'
    case Engine.EngineWorkflow: return 'child-workflow'
    default: return ''
  }
}

// The engine's own binding field key(s) -- ADR-0037: "declaration may
// pin an existing engine's config; it may never introduce new
// transform semantics," which is why the binding itself is never
// offered as a pinnable field the designer form lists (it's already
// force-hidden server-side, EngineFields()' own doc comment).
export function bindingFieldKeysFor(engine: Engine): Set<string> {
  switch (engine) {
    case Engine.EngineHTTP: return new Set(['requestId'])
    case Engine.EngineMCP: return new Set(['mcpServerId', 'toolName'])
    case Engine.EngineWorkflow: return new Set(['workflowId'])
    default: return new Set()
  }
}

// docs/adr/0009's RefKind the engine's own binding field(s) resolve
// through -- what EntityRefField needs to render the right picker.
export function refKindFor(engine: Engine): string {
  switch (engine) {
    case Engine.EngineHTTP: return 'request'
    case Engine.EngineMCP: return 'mcpserver'
    case Engine.EngineWorkflow: return 'workflow'
    default: return ''
  }
}

// A binding is complete once every field its Engine requires
// (declaredsteptype.Validate's own "exactly one of requestId /
// mcpServerId+toolName / workflowId" rule) is non-empty -- the
// designer form's own save-gate, checked client-side so an incomplete
// binding never round-trips to the server just to bounce back an
// error.
export function bindingComplete(engine: Engine, requestID: string, mcpServerID: string, toolName: string, workflowID: string): boolean {
  switch (engine) {
    case Engine.EngineHTTP: return requestID.trim() !== ''
    case Engine.EngineMCP: return mcpServerID.trim() !== '' && toolName.trim() !== ''
    case Engine.EngineWorkflow: return workflowID.trim() !== ''
    default: return false
  }
}
