package composition

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/procexec"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/domain/secret"
)

// The process-shell-command node (docs/goals/0240 S1): the coding
// loop's own execution step -- runs a captured clipboard block VERBATIM
// in the user's real login shell and real environment (no ExecEnv
// sandboxing, deliberately unlike code-execution/codeexec.go's
// "materialize, don't inherit" posture; ADR-0026's sandboxed model and
// this node's "run it exactly as approved" model are two different,
// both-legitimate execution postures -- see this file's own doc
// comment vs codeexec.go's for the contrast). Effect ClassExternal
// gates it by construction, same guardrail plane every other external
// step uses -- no bespoke approval path.
//
// A pipeline (a `|`-joined command) is ONE sub-command, one process.
// newline/&&-separated commands (codingloopparse.go) are SEPARATE
// sub-commands, run sequentially: a JoinAnd sub-command is skipped once
// a prior one has failed (preserving `&&`'s own short-circuit meaning
// even split across visible steps); a JoinNewline sub-command always
// runs regardless of what came before (matches pasting multiple lines
// into a real terminal). DBOS checkpoints this whole node as ONE step
// (its own doc comment on ShellStepProgress explains why); live,
// per-sub-command progress streams via the injected
// emitShellStepProgressFn seam instead.

// ResolvedShellCommandTarget is what a captured block will actually run
// against -- computed once so the Confirm-screen preview (codeloopsvc)
// and the real execution below never disagree about shell/cwd.
type ResolvedShellCommandTarget struct {
	Shell string
	Dir   string
	// EnvLabel names the Configure-authored execution environment the
	// block runs inside (docs/goals/0240 S4) -- empty in the default
	// real-login-shell posture.
	EnvLabel string
	// env is the child process's exact environment when an ExecEnv is
	// set (explicit-only, codeexec.go's materialize-don't-inherit
	// posture); nil in the default posture, where the process inherits
	// the caller's real environment.
	env []string
	// argvFor builds the spawn argv for one sub-command -- the ExecEnv
	// path routes through codeexec.go's shellArgv (clean/login flags
	// per the environment's ProfileMode); the default path is the bare
	// login-shell `-c` invocation this node has always used.
	argvFor func(script string) []string
}

// resolveShellCommandRunTarget picks the block's execution target from
// the node's own envId config (docs/goals/0240 S4): empty keeps the
// documented default posture (the user's real login shell and real
// environment, exactly as S1 shipped); a set envId resolves the
// Configure-authored ExecEnv through the SAME lookup code-execution
// uses -- shell flags via shellArgv, a per-BLOCK materialized dir via
// resolveDir (one temp dir for the whole block, so its sub-commands
// see each other's files), and the environment's explicit Env with
// codeexec.go's same minimal-PATH default when it declares none. A
// non-empty workingDirectory (goal 0345) overrides either posture's own
// dir through the same resolveWorkingDirectory codeexec.go's
// code-execution step uses -- one override behavior for both process
// types.
func resolveShellCommandRunTarget(envID, workingDirectory string, attrs map[string]any, run SecretAccessRun) (ResolvedShellCommandTarget, error) {
	if strings.TrimSpace(envID) == "" {
		t := ResolveShellCommandTarget()
		dir, err := resolveWorkingDirectory(workingDirectory, t.Dir, attrs)
		if err != nil {
			return ResolvedShellCommandTarget{}, err
		}
		t.Dir = dir
		t.argvFor = func(script string) []string { return []string{t.Shell, "-c", script} }
		return t, nil
	}
	re, err := lookupExecEnvFn(envID, run)
	if err != nil {
		return ResolvedShellCommandTarget{}, fmt.Errorf("process-shell-command: %w", err)
	}
	dir, err := resolveDir(re.Dir)
	if err != nil {
		return ResolvedShellCommandTarget{}, fmt.Errorf("process-shell-command: %w", err)
	}
	dir, err = resolveWorkingDirectory(workingDirectory, dir, attrs)
	if err != nil {
		return ResolvedShellCommandTarget{}, err
	}
	env := re.Env
	if len(env) == 0 {
		env = []string{"PATH=/usr/bin:/bin:/usr/sbin:/sbin"}
	}
	shell, profile := re.Shell, re.ProfileMode
	return ResolvedShellCommandTarget{
		Shell:    shellArgv(shell, profile, "")[0],
		Dir:      dir,
		EnvLabel: re.Label,
		env:      env,
		argvFor:  func(script string) []string { return shellArgv(shell, profile, script) },
	}, nil
}

// ResolveShellCommandTarget reads the process's own SHELL/HOME, exactly
// like a real terminal would -- S1 has no profile system yet (that's
// goal 0240 S4's Configure entity), so "the user's login shell" is
// resolved from the ambient process environment, not a stored
// preference.
func ResolveShellCommandTarget() ResolvedShellCommandTarget {
	shell := strings.TrimSpace(os.Getenv("SHELL"))
	if shell == "" {
		shell = DefaultLoginShellFallback
	}
	dir, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(dir) == "" {
		dir = DefaultShellCommandCwdFallback
	}
	return ResolvedShellCommandTarget{Shell: shell, Dir: dir}
}

// startShellProcessFn defaults to the real procexec.Start -- overridable
// in tests (SetShellCommandRunner), same "test against something real,
// minus the process boundary when genuinely needed" shape codeexec.go's
// own SetCodeRunner establishes. Kept as this file's own seam (not
// shared with codeexec.go's startProcessFn) so a test overriding one
// node's runner never silently affects the other's.
var startShellProcessFn = procexec.Start

// SetShellCommandRunner overrides how process-shell-command starts a
// process -- test-only; production always uses the default.
func SetShellCommandRunner(fn func(procexec.Spec) (*procexec.Handle, error)) {
	startShellProcessFn = fn
}

// tailWriter accumulates a sub-command's full output while also
// throttled-emitting a capped tail via emit -- the live half of
// ShellStepProgress's own doc comment: DBOS only sees the final output,
// this is what makes the Running screen's output tail real.
type tailWriter struct {
	mu       sync.Mutex
	full     strings.Builder
	lastSent time.Time
	emit     func(tail string)
}

func (w *tailWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	w.full.Write(p)
	now := time.Now()
	due := now.Sub(w.lastSent) >= shellStepProgressMinInterval
	tail := ""
	if due {
		tail = tailLines(w.full.String(), shellStepProgressTailLines)
		w.lastSent = now
	}
	w.mu.Unlock()
	if due {
		w.emit(tail)
	}
	return len(p), nil
}

func (w *tailWriter) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.full.String()
}

// tailLines returns the last n non-empty-trimmed lines of s -- the pure
// half of the output-tail behavior, directly testable without a real
// process.
func tailLines(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

// shellStepOutcome is runShellStep's own result -- kept separate from
// procexec.Outcome so the exec loop below can branch on exactly the
// three shapes it needs (failed/cancelled/ok) without re-deriving them
// from procexec's four-value Outcome each time.
type shellStepOutcome struct {
	output    string
	failed    bool
	cancelled bool
}

// AdminForcedAsk reports whether node is a shell step configured to run
// with administrator rights (goal 0240 S5). Read by the guardrail
// evaluation seams as well as this file's own exec path: an admin run
// ALWAYS asks -- an allow rule matching the command text never
// auto-grants privilege (the goal's recorded fail-safe policy) -- so
// every evaluator upgrades an allow verdict to ask for such a node,
// while a deny still wins unchanged.
func AdminForcedAsk(node Node) bool {
	return node.NodeTypeID == "process-shell-command" && node.Config["runWithAdmin"] == "true"
}

// adminWrapFn wraps one step's argv for an admin run -- overridable so
// tests assert the wrapping without a real sudo prompt.
var adminWrapFn = wrapArgvForAdmin

// wrapArgvForAdmin escalates via sudo's own documented GUI hook (goal
// 0240 S5's owner-decided mechanism): `sudo -A` invokes the program
// named by SUDO_ASKPASS to collect the password when no terminal
// exists, and where pam_tid is configured for sudo the system Touch ID
// prompt satisfies authentication before the askpass is ever consulted
// -- Mill never handles the credential on that path at all. The
// returned env is the real environment plus SUDO_ASKPASS (the caller
// guarantees no resolved-secret env reaches here). Headless (server
// mode) the askpass's dialog cannot appear, sudo's auth fails, and the
// step errors -- fail-closed, never a hang: sudo -A exits rather than
// waiting on a TTY.
func wrapArgvForAdmin(argv []string) ([]string, []string, error) {
	askpass, err := materializeAskpass()
	if err != nil {
		return nil, nil, err
	}
	wrapped := append([]string{"/usr/bin/sudo", "-A"}, argv...)
	env := append(os.Environ(), "SUDO_ASKPASS="+askpass)
	return wrapped, env, nil
}

// materializeAskpass writes the askpass helper sudo -A executes: a
// two-line shell script showing the standard macOS password dialog
// (osascript `display dialog ... with hidden answer` -- the
// ssh-askpass ecosystem shape; NOT the deprecated
// administrator-privileges AppleScript API) and printing the entered
// text to stdout for sudo to consume. Rewritten on every call so the
// content is always exactly this script; 0700 in the per-user temp dir
// so no other user can swap it.
func materializeAskpass() (string, error) {
	const script = "#!/bin/sh\n" +
		"exec /usr/bin/osascript -e 'display dialog \"Mill needs an administrator password to run this command.\" default answer \"\" with hidden answer with title \"Mill\" with icon caution' -e 'text returned of result'\n"
	path := filepath.Join(os.TempDir(), "mill-sudo-askpass.sh")
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil { //nolint:gosec // 0700, not 0600: sudo -A EXECUTES this file; owner-only exec is the askpass contract
		return "", fmt.Errorf("write askpass helper: %w", err)
	}
	return path, nil
}

// resolveShellSecretEnv resolves every env-var-style secret placeholder
// referenced anywhere in steps through the goal 0240 S2 chain
// (shellSecretResolverFn: typed-stash -> vault -> shell env), for this
// one run. Returns (nil, nil) when no step references any such
// placeholder -- the common case -- so the child process's Env stays
// exactly nil (unchanged S1 behavior: inherit the calling process's own
// environment verbatim) rather than paying an os.Environ() copy no run
// needs. When env refs exist, env is a full explicit copy of the
// process's own environment with each resolved name upserted (so
// substitution is the ONLY thing that changes -- .claude/rules'
// "verbatim except the resolved secret" contract), and redactValues is
// every non-empty resolved value regardless of source, for the output
// redaction pass below to scrub.
func resolveShellSecretEnv(steps []ParsedCommandStep, ctx ExecContext, baseEnv []string) (env []string, redactValues []string) {
	names := ExtractSecretEnvRefsAll(steps)
	if len(names) == 0 {
		// An ExecEnv target's environment stays explicit-only even with
		// no secret refs to resolve (docs/goals/0240 S4) -- baseEnv nil
		// is the default posture's inherit-the-real-environment case.
		return baseEnv, nil
	}
	run := secretAccessRunFromCtx(ctx)
	if baseEnv != nil {
		env = append(env, baseEnv...)
	} else {
		env = append(env, os.Environ()...)
	}
	for _, name := range names {
		value, _, found := shellSecretResolverFn(name, ctx.SecretsToken, run)
		if !found {
			// Never fail to resolve (goal 0240's own decision): leave
			// the shell to see its own ambient value for this name,
			// same as any other unresolved env var.
			continue
		}
		env = upsertEnv(env, name, value)
		if value != "" {
			redactValues = append(redactValues, value)
		}
	}
	return env, redactValues
}

// runShellStep runs ONE parsed sub-command to completion, emitting its
// running/done/failed progress -- split out of this file's init()
// purely to keep the registered exec closure's own cognitive complexity
// under the repo's gocognit threshold (.claude/rules/testing.md), not a
// change in behavior. env/redactValues come from resolveShellSecretEnv,
// computed once for the whole block.
func runShellStep(node Node, step ParsedCommandStep, total int, target ResolvedShellCommandTarget, runCtx any, env, redactValues []string) (shellStepOutcome, error) {
	redact := func(s string) string {
		out := redactSecretsFn(s)
		if len(redactValues) > 0 {
			// Vault-wide redaction above only knows about values
			// PERSISTED in the vault -- a typed-at-Confirm secret
			// (goal 0240 S2) is never stored anywhere, so an echoed
			// typed value needs this SEPARATE pass over exactly the
			// values THIS run resolved, regardless of source.
			out = secret.Redact(redactValues, out)
		}
		return out
	}

	emitShellStepProgressFn(runCtx, ShellStepProgress{
		NodeID: node.ID, StepIndex: step.Index, TotalSteps: total,
		Command: step.Text, Status: "running",
	})

	tw := &tailWriter{lastSent: time.Now()}
	tw.emit = func(tail string) {
		emitShellStepProgressFn(runCtx, ShellStepProgress{
			NodeID: node.ID, StepIndex: step.Index, TotalSteps: total,
			Command: step.Text, Status: "running", OutputTail: redact(tail),
		})
	}

	argv := target.argvFor(step.Text)
	if AdminForcedAsk(node) {
		// Secret env values cannot survive sudo's own env_reset -- the
		// escalated child would silently run WITHOUT the resolved
		// secrets, which is exactly the silent-divergence the verbatim
		// contract forbids. Refuse the combination honestly instead.
		if env != nil {
			return shellStepOutcome{}, fmt.Errorf("process-shell-command: a block referencing secrets can't run with admin rights (sudo strips the resolved environment)")
		}
		var wrapErr error
		argv, env, wrapErr = adminWrapFn(argv)
		if wrapErr != nil {
			return shellStepOutcome{}, fmt.Errorf("process-shell-command: %w", wrapErr)
		}
	}
	handle, err := startShellProcessFn(procexec.Spec{
		Argv: argv,
		Dir:  target.Dir,
		// Env nil (the common case, resolveShellSecretEnv's own doc
		// comment) falls back to the calling process's real environment
		// -- exactly "the user's real shell environment" this node's own
		// doc comment promises, unlike code-execution's explicit-only
		// ExecEnv.Env. Non-nil only when this block references a secret
		// placeholder: a full copy of that same real environment with
		// the resolved value(s) upserted, so substitution is the ONLY
		// change from the nil-Env behavior.
		Env:    env,
		Output: tw,
	})
	if err != nil {
		return shellStepOutcome{}, fmt.Errorf("process-shell-command: start: %w", err)
	}

	unregister := registerRunningProcessFn(runCtx, node.ID, handle)
	result := handle.Wait()
	unregister()

	stepOutput := redact(tw.String())

	if result.Outcome == procexec.OutcomeHardTimeout || result.Outcome == procexec.OutcomeIdleTimeout {
		// No timeout is configured by this node (Spec.HardTimeout/
		// IdleTimeout both left zero -- goal 0240 S1's own "no timeouts
		// by default" directive), so this is unreachable in production;
		// handled anyway so a future Spec change can't silently
		// misreport an unreached case as a plain failure.
		return shellStepOutcome{}, fmt.Errorf("process-shell-command: unexpected timeout outcome for %q", step.Text)
	}

	failed := result.Outcome != procexec.OutcomeCancelled && (result.Err != nil || result.ExitCode != 0)
	status := "done"
	if result.Outcome == procexec.OutcomeCancelled || failed {
		status = "failed"
	}
	emitShellStepProgressFn(runCtx, ShellStepProgress{
		NodeID: node.ID, StepIndex: step.Index, TotalSteps: total,
		Command: step.Text, Status: status, OutputTail: stepOutput, ExitCode: result.ExitCode,
	})

	return shellStepOutcome{output: stepOutput, failed: failed, cancelled: result.Outcome == procexec.OutcomeCancelled}, nil
}

// runShellCommandBlock is the registered exec function's own body,
// split out for the same gocognit reason runShellStep's doc comment
// states. steps is always non-empty (the init() closure below rejects
// an empty parse before calling this).
func runShellCommandBlock(node Node, ctx ExecContext, steps []ParsedCommandStep) (ExecContext, error) {
	target, err := resolveShellCommandRunTarget(node.Config["envId"], node.Config["workingDirectory"], ctx.Attributes, secretAccessRunFromCtx(ctx))
	if err != nil {
		return ctx, err
	}
	env, redactValues := resolveShellSecretEnv(steps, ctx, target.env)
	var combined strings.Builder
	// lastFailed propagates a failure forward ONLY across && steps
	// (docs/goals/0240 S1: "&&"'s own short-circuit meaning, preserved
	// even though the two sides now render as separate visible steps)
	// -- a JoinNewline step always runs regardless (matches pasting
	// multiple lines into a real terminal) and resets lastFailed to its
	// OWN outcome once it does.
	lastFailed := false
	anyFailed := false

	for _, step := range steps {
		if lastFailed && step.Join == JoinAnd {
			emitShellStepProgressFn(ctx.RunContext, ShellStepProgress{
				NodeID: node.ID, StepIndex: step.Index, TotalSteps: len(steps), Command: step.Text, Status: "skipped",
			})
			fmt.Fprintf(&combined, "$ %s\n(skipped: a previous && step failed)\n\n", step.Text)
			continue
		}

		outcome, err := runShellStep(node, step, len(steps), target, ctx.RunContext, env, redactValues)
		if err != nil {
			return ctx, err
		}
		fmt.Fprintf(&combined, "$ %s\n%s\n\n", step.Text, outcome.output)

		if outcome.cancelled {
			ctx.Payload = combined.String()
			return ctx, fmt.Errorf("process-shell-command: %w", errCancelledByUser)
		}
		lastFailed = outcome.failed
		anyFailed = anyFailed || outcome.failed
	}

	ctx.Payload = combined.String()
	if anyFailed {
		return ctx, fmt.Errorf("process-shell-command: a step failed. See the run's output for which one")
	}
	return ctx, nil
}

func init() {
	RegisterNodeType(NodeType{
		ID: "process-shell-command", Kind: KindProcess,
		Effect:      guardrail.ClassExternal,
		Complexity:  ComplexityAdvanced,
		Consumes:    []PayloadKind{PayloadText},
		Produces:    PayloadProduce{Kind: PayloadText},
		Output:      "combined stdout+stderr from every sub-command that ran",
		Label:       "Run a captured command",
		Description: "Runs the captured payload exactly as written, in your real login shell by default, or inside a Configure-authored execution environment (its shell, directory, and variables) when one is chosen. A piped command stays one step; commands separated by a new line or && show as separate steps. External effect: the run asks for your approval by default.",
		ConfigFields: []ConfigField{
			{
				Key: "envId", Label: "Execution environment",
				Description: "Runs the block inside a Configure-authored environment. Empty runs your real login shell.",
				Default:     "", Type: FieldText, RefKind: "execenv", OptionalRef: true,
			},
			{
				Key: "runWithAdmin", Label: "Run with admin rights", Type: FieldBoolean,
				Description: "Runs each command with administrator rights. macOS asks you to approve every run — Touch ID when it's set up for sudo, your password otherwise.",
				Default:     "false",
			},
			{
				Key: "workingDirectory", Label: "Working directory",
				Description: "Overrides the environment's directory. Use {param} for a value from this run.",
				Default:     "", Type: FieldText,
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		steps := ParseShellCommandBlock(ctx.Payload)
		if len(steps) == 0 {
			return ctx, fmt.Errorf("process-shell-command: nothing to run (empty command)")
		}
		return runShellCommandBlock(node, ctx, steps)
	})
}
