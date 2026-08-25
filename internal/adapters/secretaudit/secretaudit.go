// Package secretaudit holds the pure, dependency-free types for Mill's
// secret-read audit trail (goal 0203 S3): every vault entry read, no
// matter which seam resolved it, produces one Record answering what/
// when/on-whose-behalf. Sibling of internal/adapters/mcpaudit, mirroring
// its store/list/retention SHAPE deliberately (.claude/rules/
// architecture.md's reuse discipline) -- but a secret read is never an
// MCP call, so this is its OWN table via internal/adapters/
// secretauditstore, never mcpaudit's. Deliberately an adapter-layer
// package (never internal/domain) since it's imported by configuresvc
// (a service, allowed to depend on adapters) to tag which seam is
// resolving a "vault:" reference -- composition (a domain package)
// never imports it; composition.SecretAccessRun stays a plain
// correlation-id pair with no audit vocabulary of its own.
package secretaudit

import "time"

// Context is WHICH seam resolved one vault entry -- the survey the goal
// file's S3 contract names, each tied to exactly one call site:
type Context string

const (
	// ContextMCPServerSpawn is configuremcpserver.go's resolveMCPServer
	// -- an MCP server's "vault:" env entries resolved to spawn/connect
	// to it, whether from a real mcp-tool-call node run or a dangling-
	// reference existence check (composition.RefExists).
	ContextMCPServerSpawn Context = "mcp-server-spawn"
	// ContextExecEnv is configureexecenv.go's resolveExecEnv -- a
	// code-execution node's execution environment "vault:" env entries.
	ContextExecEnv Context = "exec-env"
	// ContextHTTPHeader is configureservice_requestauth.go's
	// resolveHTTPRequest -- an integration's custom "vault:" header
	// value.
	ContextHTTPHeader Context = "http-header"
	// ContextConfigureToolsPreview is ListMCPServerTools -- the
	// Configure page's live tool-list lookup, S2's own found gap: it
	// spawns the real MCP server (resolving its vault-referenced env)
	// outside any workflow run, with no guardrail gate on the path. This
	// slice's job is only to make that read visible, not to gate it
	// (goal file, S3 contract).
	ContextConfigureToolsPreview Context = "configure-tools-preview"
	// ContextUIReveal is SecretService.RevealSecret -- a human clicking
	// "reveal" in the Secrets view.
	ContextUIReveal Context = "ui-reveal"
	// ContextUICopy is SecretService.CopySecretToClipboard -- a human
	// clicking "copy."
	ContextUICopy Context = "ui-copy"
)

// Outcome is one read's recorded result -- deliberately just two values
// (unlike mcpaudit.Outcome's richer parked-write lifecycle): a secret
// resolution is a synchronous read, never a park-and-poll write.
type Outcome string

const (
	OutcomeRead  Outcome = "read"
	OutcomeError Outcome = "error"
)

// ErrorTextCap/TruncateError mirror mcpaudit's own cap and reasoning --
// a locked-vault or malformed-id error should never let one row's text
// dominate the retention window.
const ErrorTextCap = 4096

// TruncateError caps s to ErrorTextCap bytes, leaving it untouched when
// already within budget.
func TruncateError(s string) string {
	if len(s) <= ErrorTextCap {
		return s
	}
	return s[:ErrorTextCap]
}

// AccessContext is what a resolution seam knows about itself at the
// moment it calls SecretService.ResolveSecretValue -- Context is always
// known statically (each seam calls with its own fixed value); RunID/
// WorkflowID are populated only when the read happened inside an actual
// workflow run (composition.SecretAccessRun, threaded from ExecContext)
// and are the zero value for every other caller (a Configure-page
// preview, a dangling-reference existence check, a static graph
// validation pass) -- "when in-run" per the goal file's own contract,
// never a required field.
type AccessContext struct {
	Context    Context
	RunID      string
	WorkflowID string
}

// Record is one vault entry read. Label is denormalized (the entry's
// title AT READ TIME) -- a later rename must never rewrite history, the
// same reasoning every other denormalized-label record in this codebase
// already follows.
type Record struct {
	ID         int64
	Timestamp  time.Time
	EntryID    string
	Label      string
	Context    Context
	RunID      string
	WorkflowID string
	Outcome    Outcome
	// ErrorText is capped via TruncateError before it ever reaches
	// storage; empty for OutcomeRead.
	ErrorText string
}
