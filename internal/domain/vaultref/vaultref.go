// Package vaultref holds the one string-level convention every
// Configure entity field that may name a stored secret shares: a value
// of the literal form "vault:<entry-id>" points at a secretsvc vault
// entry rather than carrying a literal value itself (goal 0185 S3,
// extended to a general reference type by goal 0203 S1). Originally
// declared only inside internal/domain/mcpserver (MCPServer.Env was
// the sole consumer); lifted here once a second KEY=VALUE-shaped field
// (ExecEnv.Env) and a third, single-value field (HTTPRequest.Headers)
// needed the identical parsing rule, so every consumer shares one
// spelling instead of each declaring its own prefix constant.
//
// A leaf package deliberately, mirroring internal/domain/typedfield's
// own reasoning: zero internal imports, so every domain package that
// declares a vault-referenceable field (mcpserver, execenv, httprequest)
// and the configuresvc service layer that resolves the reference can
// all import this without creating a cycle. Parsing only -- resolving
// an id to its real secret is a service-layer concern (it needs
// secretsvc's own store), never done here.
package vaultref

import "strings"

// Prefix marks a field value as a vault entry reference rather than a
// literal -- "vault:<entry-id>". Exported so every resolving call site
// and every declaring domain package's own doc comment share one
// spelling.
const Prefix = "vault:"

// Parse reports whether value (a field's own value, or a KEY=VALUE env
// entry's value half after the "KEY=" split) names a vault entry,
// returning its id.
func Parse(value string) (id string, ok bool) {
	rest, found := strings.CutPrefix(value, Prefix)
	return rest, found
}
