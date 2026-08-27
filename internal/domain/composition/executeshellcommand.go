package composition

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/procexec"
	"github.com/alicoding/mill/internal/domain/guardrail"
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

// runShellStep runs ONE parsed sub-command to completion, emitting its
// running/done/failed progress -- split out of this file's init()
// purely to keep the registered exec closure's own cognitive complexity
// under the repo's gocognit threshold (.claude/rules/testing.md), not a
// change in behavior.
func runShellStep(node Node, step ParsedCommandStep, total int, target ResolvedShellCommandTarget, runCtx any) (shellStepOutcome, error) {
	emitShellStepProgressFn(runCtx, ShellStepProgress{
		NodeID: node.ID, StepIndex: step.Index, TotalSteps: total,
		Command: step.Text, Status: "running",
	})

	tw := &tailWriter{lastSent: time.Now()}
	tw.emit = func(tail string) {
		emitShellStepProgressFn(runCtx, ShellStepProgress{
			NodeID: node.ID, StepIndex: step.Index, TotalSteps: total,
			Command: step.Text, Status: "running", OutputTail: redactSecretsFn(tail),
		})
	}

	handle, err := startShellProcessFn(procexec.Spec{
		Argv: []string{target.Shell, "-c", step.Text},
		Dir:  target.Dir,
		// Env deliberately nil: procexec.Spec's own doc says a nil Env
		// falls back to the calling process's real environment --
		// exactly "the user's real shell environment" this node's own
		// doc comment promises, unlike code-execution's explicit-only
		// ExecEnv.Env.
		Output: tw,
	})
	if err != nil {
		return shellStepOutcome{}, fmt.Errorf("process-shell-command: start: %w", err)
	}

	unregister := registerRunningProcessFn(runCtx, node.ID, handle)
	result := handle.Wait()
	unregister()

	stepOutput := redactSecretsFn(tw.String())

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
	target := ResolveShellCommandTarget()
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
			fmt.Fprintf(&combined, "$ %s\n(skipped -- a previous && step failed)\n\n", step.Text)
			continue
		}

		outcome, err := runShellStep(node, step, len(steps), target, ctx.RunContext)
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
		return ctx, fmt.Errorf("process-shell-command: a step failed -- see the run's output for which one")
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
		Description: "Runs the captured payload in your real login shell, exactly as written -- no sandboxing, no stored environment profile. A piped command stays one step; commands separated by a new line or && show as separate steps. External effect -- the run asks for your approval by default. No configurable fields: this node always runs whatever payload it receives.",
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		steps := ParseShellCommandBlock(ctx.Payload)
		if len(steps) == 0 {
			return ctx, fmt.Errorf("process-shell-command: nothing to run (empty command)")
		}
		return runShellCommandBlock(node, ctx, steps)
	})
}
