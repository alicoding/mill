package composition

import "context"

// secretAccessRunContextKey is an unexported context.Context key type
// (the Go-documented way to avoid collisions across packages) carrying
// a SecretAccessRun across an adapter boundary that has no ExecContext
// of its own to read (goal 0371): a client-certificate TLS handshake
// happens lazily, inside net/http's own dial, reached only through the
// context.Context httpconnector.Request forwards -- the same
// "attach on a Context, read it back on the other side" shape
// mcpaudit.WithCallerIdentity/CallerIdentityFromContext already
// establishes for MCP calls.
type secretAccessRunContextKey struct{}

// WithSecretAccessRun attaches run onto ctx for a callee on the other
// side of an adapter boundary (httpconnector) to read back via
// SecretAccessRunFromContext. composition itself never reads this back
// -- only sendHTTPRequest writes it, only configuresvc's client-
// certificate resolver reads it.
func WithSecretAccessRun(ctx context.Context, run SecretAccessRun) context.Context {
	return context.WithValue(ctx, secretAccessRunContextKey{}, run)
}

// SecretAccessRunFromContext reads back what WithSecretAccessRun
// attached. Returns the zero SecretAccessRun (never an error) when
// nothing was attached -- every non-run caller (a Configure-page "Test"
// click, a plugin fetch) reaching the same TLS resolver.
func SecretAccessRunFromContext(ctx context.Context) SecretAccessRun {
	run, _ := ctx.Value(secretAccessRunContextKey{}).(SecretAccessRun)
	return run
}
