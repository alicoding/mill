package composition

import (
	"regexp"
	"time"
)

// The coding-loop feature's own named-constants module (docs/goals/0240
// S1's own build directive: every design value that shapes the parse/
// run/display behavior lives here, in ONE place, rather than scattered
// as inline literals across the parser, the node executor, and the
// preview RPC -- so a later slice (S2's secret chain, S4's profiles)
// can change one of these without hunting for a second copy.

// DefaultLoginShellFallback is used when the process's own SHELL
// environment variable is unset -- a real interactive login always sets
// it (macOS Terminal and every Linux distribution both export SHELL),
// so this only matters for a headless/CI/minimal-container process with
// no real shell context, e.g. this package's own test suite. POSIX sh
// is guaranteed present on both of Mill's supported platforms, unlike
// zsh (macOS-only since Catalina -- execenv/builtin.go's own doc
// comment makes the identical portability point for ExecEnv's seed).
const DefaultLoginShellFallback = "/bin/sh"

// DefaultShellCommandCwdFallback is used when the real user's home
// directory can't be resolved (os.UserHomeDir erroring) -- an
// unreachable edge case in practice, named so ResolveShellCommandTarget
// never has a silent empty-string cwd.
const DefaultShellCommandCwdFallback = "/tmp"

// shellStepProgressTailLines caps how many trailing lines of a running
// sub-command's output travel in each ShellStepProgress event -- the
// backend half of the no-hardcode "output-tail length" constant the
// goal names; frontend/src/shared/codingLoopConstants.ts's
// CODING_LOOP_OUTPUT_TAIL_LINES is its TypeScript-side counterpart
// (Go and TS can't share one literal across the process boundary, so
// this is the one Go-side definition, not a second copy of the concept
// -- see this file's own header comment).
const shellStepProgressTailLines = 12

// shellStepProgressMinInterval throttles how often a running
// sub-command's incremental output re-emits a ShellStepProgress event
// -- a chatty command (a tight log-printing loop) would otherwise flood
// the Wails event bridge with one event per Write call. The final
// state for a sub-command (done/failed/skipped) always emits
// immediately regardless of this interval.
const shellStepProgressMinInterval = 150 * time.Millisecond

// secretPlaceholderPatterns are heuristic-only shapes a captured
// command line might carry in place of a real secret -- angle-bracket
// placeholders (<TOKEN>), shouty YOUR_*/MY_* markers, and an unresolved
// shell variable reference. S1 never resolves a secret (goal 0240's own
// slice plan defers that to S2's vault->env->prompt chain); a match
// here only drives the Confirm screen's "will run as-is" label, never a
// runtime substitution or a block.
var secretPlaceholderPatterns = []*regexp.Regexp{
	regexp.MustCompile(`<[A-Za-z0-9_-]*(?:TOKEN|SECRET|PASSWORD|KEY|CRED)[A-Za-z0-9_-]*>`),
	regexp.MustCompile(`\b(?:YOUR|MY)_[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)[A-Z0-9_]*\b`),
	regexp.MustCompile(`\$\{?[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)[A-Z0-9_]*\}?`),
}

// looksLikeSecretPlaceholder reports whether text contains any of the
// heuristic shapes above -- case-sensitive by design (a lowercase
// "token" inside a real command is common and not usually a
// placeholder; the shapes above are deliberately shouty/bracketed,
// matching how M365 and similar tools actually render "fill this in"
// markers).
func looksLikeSecretPlaceholder(text string) bool {
	for _, p := range secretPlaceholderPatterns {
		if p.MatchString(text) {
			return true
		}
	}
	return false
}

// secretEnvRefPattern is the ONE placeholder shape goal 0240 S2 actually
// resolves and substitutes: a shell env-var reference, `${VAR}` or bare
// `$VAR`, whose name is itself secret-shaped. This is the DECIDED
// answer to "how do M365-style commands actually reference a secret" --
// env-var style is primary because it's real, already-valid shell
// syntax (a captured `curl -H "Authorization: Bearer ${GITHUB_TOKEN}"`
// needs no rewriting) and because resolving through the child process's
// ENVIRONMENT rather than by rewriting the command TEXT means the
// resolved value never has to touch (and therefore can never leak
// into) the displayed step text, the captured-command history, or any
// log line -- only the placeholder name ever appears there. The other
// two S1 heuristic shapes (`<TOKEN>`, `YOUR_TOKEN`) are not valid shell
// substitution syntax and stay display-only, exactly as S1 left them --
// this pattern is deliberately its OWN definition, not a capture-group
// retrofit of secretPlaceholderPatterns's third entry, so a future
// change to one heuristic's display shape can't silently change what
// actually gets resolved.
var secretEnvRefPattern = regexp.MustCompile(`\$\{?([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|CRED)[A-Z0-9_]*)\}?`)

// TypedSecretsTokenTTL bounds how long codeloopsvc's in-memory typed-
// secrets stash keeps an unused entry (a Confirm screen where the user
// typed a secret then cancelled instead of running) -- long enough to
// cover a real "type it, then click Run" pause, short enough that a
// stash never accumulates across a session. Not a persistence window:
// a typed secret is never written to disk at any point in its
// lifetime, this only bounds how long it sits in process memory.
// Declared here (composition owns the coding loop's own constants
// module, this file's header comment) even though only codeloopsvc's
// stash (a service-layer concern) reads it -- a service importing a
// domain-layer constant is the normal Bindings->Domain->Adapters
// direction (.claude/rules/backend.md), never the reverse.
const TypedSecretsTokenTTL = 15 * time.Minute
