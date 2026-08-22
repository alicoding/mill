package mcpaudit

import "context"

// callerIdentityKey is unexported so no other package can collide with
// or forge this context value -- same "unexported key type" idiom
// Go's own context package doc comment prescribes.
type callerIdentityKey struct{}

// WithCallerIdentity attaches the calling workflow step id (or, for the
// agent loop, "agentloop-<sessionID>") to ctx, read back by
// CallerIdentityFromContext inside the client-sending audit middleware
// (internal/services/mcpauditsvc). This is the single mechanism both
// mcpclient's stdio connector calls AND the agent loop's in-memory
// session use to identify themselves -- no separate per-caller path.
func WithCallerIdentity(ctx context.Context, identity string) context.Context {
	return context.WithValue(ctx, callerIdentityKey{}, identity)
}

// CallerIdentityFromContext reads back the identity WithCallerIdentity
// attached, or "" if none was ever set.
func CallerIdentityFromContext(ctx context.Context) string {
	v, _ := ctx.Value(callerIdentityKey{}).(string)
	return v
}
