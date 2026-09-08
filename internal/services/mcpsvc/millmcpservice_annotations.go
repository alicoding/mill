package mcpsvc

import "github.com/modelcontextprotocol/go-sdk/mcp"

// Tool annotations (goal 0388, the MCP spec's own tool-annotations
// contract): the SDK's mcp.Tool.Annotations field (*mcp.ToolAnnotations{
// DestructiveHint *bool, IdempotentHint bool, OpenWorldHint *bool,
// ReadOnlyHint bool, Title string} -- internal/services/mcpsvc's own
// reading of go-sdk@v1.7.0's mcp/protocol.go) was declared but never populated
// anywhere in this package; every tool registration below fills it
// in, mechanically, from the tool's own declared effect class -- never
// per-call, since annotations describe the TOOL, not one invocation.
// No new library: this is the vendored SDK's own struct, unused until
// now (.claude/rules/architecture.md's "adopt the whole API" rule
// applied retroactively).
//
// One shared *mcp.ToolAnnotations value per effect class, referenced
// by every tool of that class, so the class stays a single named
// thing to change rather than a fact repeated at forty call sites:
//
//   - readOnly: never mutates Mill's own data. Destructive/idempotent
//     are meaningless per the spec's own doc comment when
//     ReadOnlyHint is true, so both stay their zero value.
//   - createAnnotations: mints a new entity/object/file; calling twice
//     creates two, so never idempotent; adds without touching
//     anything that already existed, so never destructive.
//   - appendAnnotations: adds one new row/entry to something that
//     already exists, same non-idempotent/non-destructive shape as
//     create -- kept as its own name because an append's ADDRESS is a
//     position in an existing collection, a create's is a fresh id.
//   - editAnnotations: changes only the parts of an existing,
//     already-addressed thing that are named; replaying the same call
//     ends in the same state (idempotent), and nothing named is
//     removed, only overwritten (non-destructive).
//   - deleteAnnotations: removes something that existed; destructive,
//     and idempotent (deleting an already-gone id ends in the same
//     "gone" state either way).
//   - replaceAnnotations: overwrites an existing, already-addressed
//     entity's whole content in one call (never a partial patch);
//     destructive (the previous content is discarded, even when a
//     revert path exists elsewhere) and idempotent (replaying the same
//     replace ends in the same state).
//   - mixedAnnotations: one tool spans more than one of the classes
//     above by mode/argument (create-or-update, or an import whose
//     mode can replace) -- annotated at its WORST case per class,
//     since a client reads the registration once, not per call.
//   - executeAnnotations: performs a real external-effect action (an
//     HTTP call, a workflow run, a run-control step) rather than
//     reading or writing Mill's own stored data; open-world (the
//     effect can reach outside Mill), destructive (its outside effect
//     is not guaranteed reversible) and non-idempotent (repeating it
//     performs the action again).
var (
	readOnlyAnnotations   = &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: boolPtr(false)}
	createAnnotations     = &mcp.ToolAnnotations{DestructiveHint: boolPtr(false), IdempotentHint: false, OpenWorldHint: boolPtr(false)}
	appendAnnotations     = &mcp.ToolAnnotations{DestructiveHint: boolPtr(false), IdempotentHint: false, OpenWorldHint: boolPtr(false)}
	editAnnotations       = &mcp.ToolAnnotations{DestructiveHint: boolPtr(false), IdempotentHint: true, OpenWorldHint: boolPtr(false)}
	deleteAnnotations     = &mcp.ToolAnnotations{DestructiveHint: boolPtr(true), IdempotentHint: true, OpenWorldHint: boolPtr(false)}
	replaceAnnotations    = &mcp.ToolAnnotations{DestructiveHint: boolPtr(true), IdempotentHint: true, OpenWorldHint: boolPtr(false)}
	mixedAnnotations      = &mcp.ToolAnnotations{DestructiveHint: boolPtr(true), IdempotentHint: false, OpenWorldHint: boolPtr(false)}
	executeAnnotations    = &mcp.ToolAnnotations{DestructiveHint: boolPtr(true), IdempotentHint: false, OpenWorldHint: boolPtr(true)}
	pluginWriteAnnotation = &mcp.ToolAnnotations{DestructiveHint: boolPtr(true), IdempotentHint: false, OpenWorldHint: boolPtr(true)}
	pluginReadAnnotation  = &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: boolPtr(true)}
)

func boolPtr(b bool) *bool { return &b }

// pluginToolAnnotations answers a plugin-declared tool's annotations
// from its manifest-declared effect ("read" or "write", PluginToolSpec
// -- millmcpservice_plugins.go): open-world in both directions,
// because a plugin's own step/command/query can reach anywhere its
// author wrote it to, unlike Mill's own tools which only ever touch
// Mill's own stored data.
func pluginToolAnnotations(effect string) *mcp.ToolAnnotations {
	if effect == "write" {
		return pluginWriteAnnotation
	}
	return pluginReadAnnotation
}
