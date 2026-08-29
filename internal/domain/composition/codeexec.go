package composition

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/adapters/procexec"
	"github.com/alicoding/mill/internal/domain/execenv"
	"github.com/alicoding/mill/internal/domain/guardrail"
)

// The code-execution node (docs/adr/0026, goal 0004b): SPEC §2.1's core
// loop closer to real -- a captured command (or a literal script)
// actually runs, locally, inside a Configure-authored, pinned
// ExecEnv. Effect ClassExternal means the ambient guardrail gate
// (docs/adr/0022) asks by default, same as integration-http/
// mcp-tool-call -- this IS SPEC §2.1's "the hotkey press is the
// guardrail gesture" made concrete for command execution, not a
// separate mechanism.
//
// DBOS supervises none of this (ADR-0026's Amendment, its own boundary
// statement, restated in internal/adapters/procexec's package doc):
// procexec.Start/Handle own the live process end to end -- spawn,
// stream, kill. This file's only job is resolving an ExecEnv + a
// node's config into one procexec.Spec and interpreting the Result.

// ResolvedExecEnv is an ExecEnv's connection config, assembled by
// whatever owns ExecEnv storage at request time (ConfigureService) --
// same injected-seam shape as ResolvedHTTPRequest/ResolvedMCPServer/
// ResolvedList: composition doesn't own ExecEnv persistence, so this is
// wired once via SetExecEnvLookup rather than composition depending on
// configuresvc directly (.claude/rules/backend.md).
type ResolvedExecEnv struct {
	Shell       string
	ProfileMode string
	Dir         string
	Env         []string
	// Label is the environment's own display name -- the shell step's
	// target line names which environment a block runs inside
	// (docs/goals/0240 S4); code-execution ignores it.
	Label string
}

// lookupExecEnvFn defaults to erroring so a code-execution node run
// before ConfigureService exists (or before SetExecEnvLookup wires it)
// fails loudly instead of silently no-op'ing -- same pattern every
// other lookup*Fn in this package already uses. Takes a SecretAccessRun
// (goal 0203 S3), see mcpcall.go's lookupMCPServerFn for the reasoning.
var lookupExecEnvFn = func(envID string, _ SecretAccessRun) (ResolvedExecEnv, error) {
	return ResolvedExecEnv{}, fmt.Errorf("no execution environment lookup registered (yet) for id %q", envID)
}

// SetExecEnvLookup wires the function code-execution nodes use to
// resolve an envId into its shell/profile/dir/env. Called once from
// main.go once ConfigureService exists.
func SetExecEnvLookup(fn func(envID string, run SecretAccessRun) (ResolvedExecEnv, error)) {
	lookupExecEnvFn = fn
}

// startProcessFn defaults to the real procexec.Start (production's only
// path) -- overridable in tests (SetCodeRunner) the same "test against
// something real, minus the process boundary when that's genuinely
// needed" shape SetMCPCallTool/SetHTTPRequestLookup's own test seams
// already establish. Most of this file's own tests exercise the real
// default rather than overriding it -- procexec spawning `echo`/`sh -c`
// is already fast and hermetic, nothing to fake.
var startProcessFn = procexec.Start

// SetCodeRunner overrides how code-execution nodes actually start a
// process -- test-only; production always uses the default
// (procexec.Start).
func SetCodeRunner(fn func(procexec.Spec) (*procexec.Handle, error)) {
	startProcessFn = fn
}

// registerRunningProcessFn defaults to a no-op so a code-execution node
// run with no durable caller wired (composition.ExecuteWorkflow's own
// unit tests, which never install this seam) still runs the process --
// it just isn't cancellable from outside, which is correct for a
// caller with no run identity to cancel by. Returns an unregister
// func, called via defer once the step finishes either way -- same
// register/defer-unregister shape as every other injected per-run seam
// here (waitForApprovalFn's own park/resume doesn't need one since it
// blocks synchronously, but a live process handle needs to be
// reachable from OUTSIDE this call while it's still running).
var registerRunningProcessFn = func(_ any, _ string, _ *procexec.Handle) func() {
	return func() {}
}

// SetProcessRegistrar wires the function a code-execution node uses to
// publish its live procexec.Handle for external cancellation
// (executionservice_cancel.go's CancelRun RPC) -- called once from
// main.go once ExecutionService exists, mirroring
// SetGuardrailGate/SetApprovalWaiter's own "domain package declares
// the seam, the durable service layer fills it in" shape.
func SetProcessRegistrar(fn func(runCtx any, nodeID string, h *procexec.Handle) func()) {
	registerRunningProcessFn = fn
}

// CancelledByUserMessage is returned (wrapped) when a running command
// was killed via an explicit Cancel -- executionservice.go's GetRun
// matches this exported string to record a distinct "cancelled" step
// status rather than lumping it in with an ordinary "failed"
// (ADR-0026: "cancelled != failed != interrupted -- three distinct
// recorded outcomes with distinct UI treatment"). Exported (not a
// shared error value) since the message crosses a DBOS checkpoint
// (RunAsStep's result is JSON-decoded back from SQLite on read) and
// only Error() survives that round trip, never Go error identity --
// confirmed against decodeAny's own doc comment (executionservice.go),
// which is exactly why every other cross-checkpoint match in this
// codebase (e.g. GetRun's "denied by user"/"timed out" checks) already
// matches on substring, not errors.Is. Exporting the string itself
// (rather than each caller hardcoding a copy) keeps the two sides from
// silently drifting.
const CancelledByUserMessage = "cancelled by user"

var errCancelledByUser = errors.New(CancelledByUserMessage)

const defaultTimeoutSeconds = 120

// shellArgv assembles one command's full argv from an ExecEnv's
// Shell/ProfileMode -- researched directly against zsh(1)/bash(1)
// (`man zsh`/`man zshall`, `man bash`, not assumed or copied from a
// blog post):
//
//   - clean (no-rc) mode: zsh's ZDOTDIR/.zshenv is read UNCONDITIONALLY
//     on every invocation -- interactive, non-interactive, login or
//     not (zshall(1) STARTUP/SHUTDOWN FILES: "Commands are then read
//     from $ZDOTDIR/.zshenv" is the very first, unconditional step,
//     before any login/interactive check) -- unlike bash, where a
//     plain `bash -c` is already non-interactive and non-login so no
//     profile/rc file is read by default regardless. zsh's NO_RCS
//     option (single-letter -f, confirmed in zshall(1)'s OPTIONS
//     table) suppresses that unconditional .zshenv read; zshmisc(1)
//     confirms GNU-style long options translate `-` to `_`, so
//     `--no-rcs` on the command line sets NO_RCS the same as -f.
//     bash's own --noprofile/--norc are documented directly in
//     bash(1) as the flags that inhibit /etc/profile+~/.bash_profile
//     and ~/.bashrc respectively -- redundant for a non-interactive
//     `-c` invocation in practice, passed anyway for defense-in-depth
//     and to make the "nothing but the declared Env" guarantee
//     explicit rather than incidental. Plain POSIX sh has no
//     unconditional startup-file read to suppress in `-c` mode, so
//     clean mode passes no extra flag.
//   - login mode: `-l` (bash(1)/zsh(1) both document -l as the login
//     flag) sources the shell's own login/profile files in addition
//     to the ExecEnv's declared Env -- "terminal parity" per
//     ADR-0026's Amendment. sh's own `-l` support is less uniformly
//     documented across POSIX sh implementations (dash does support
//     it; the exact file(s) read vary by implementation) -- passed
//     for consistency with the other two shells, a documented, not
//     silently assumed, soft spot.
func shellArgv(shell, profile, script string) []string {
	login := profile == string(execenv.ProfileLogin)
	switch execenv.Shell(shell) {
	case execenv.ShellBash:
		if login {
			return []string{"/bin/bash", "-l", "-c", script}
		}
		return []string{"/bin/bash", "--noprofile", "--norc", "-c", script}
	case execenv.ShellSh:
		if login {
			return []string{"/bin/sh", "-l", "-c", script}
		}
		return []string{"/bin/sh", "-c", script}
	default: // execenv.ShellZsh, and any unrecognized value -- fall back to zsh's own clean flag rather than guessing at another shell's syntax
		if login {
			return []string{"/bin/zsh", "-l", "-c", script}
		}
		return []string{"/bin/zsh", "--no-rcs", "-c", script}
	}
}

// resolveDir turns an ExecEnv's Dir into a real, existing directory --
// TempDirSentinel mints a fresh one per run (os.MkdirTemp), matching
// the seeded "Safe sandbox" env's own design (nothing this env
// executes can touch real user files by construction). NOT cleaned up
// after the run -- deliberately: a script's own output files are a
// legitimate thing to want to inspect afterward, and this pass doesn't
// build a retention/cleanup policy for them (a named, real gap, not an
// oversight -- see this goal's own final report).
func resolveDir(dir string) (string, error) {
	if dir != execenv.TempDirSentinel && dir != "" {
		return dir, nil
	}
	tmp, err := os.MkdirTemp("", "mill-execenv-")
	if err != nil {
		return "", fmt.Errorf("mint temp dir: %w", err)
	}
	return tmp, nil
}

func init() {
	RegisterNodeType(NodeType{
		ID: "code-execution", Kind: KindProcess,
		Effect:      guardrail.ClassExternal,
		Complexity:  ComplexityAdvanced,
		Consumes:    []PayloadKind{PayloadText, PayloadNone},
		Produces:    PayloadProduce{Kind: PayloadText},
		Output:      "combined stdout+stderr from the executed command",
		Label:       "Run a command",
		Description: "Runs one command locally, inside a configured execution environment (pinned shell, directory, and environment). External effect -- the run asks for approval by default. Source \"payload\" runs the upstream payload as the command; \"literal\" runs a fixed script instead. A running command can be stopped from this workflow's Runs tab.",
		ConfigFields: []ConfigField{
			{
				Key: "envId", Label: "Execution environment",
				Description: "Which Configure-authored environment (shell, working directory, env vars) this command runs inside.",
				Default:     "", Type: FieldText, RefKind: "execenv",
			},
			{
				Key: "source", Label: "Command source", Type: FieldOptions,
				Description: "\"payload\" runs the captured/upstream payload as the command; \"literal\" runs the script below instead.",
				Default:     "payload", Options: []string{"payload", "literal"},
			},
			{
				Key: "script", Label: "Script", Multiline: true,
				Description: "The command to run when \"Command source\" is literal. Ignored when source is payload.",
				Default:     "", Type: FieldText,
			},
			{
				Key: "timeoutSeconds", Label: "Timeout (seconds)", Type: FieldNumber,
				Description: "Kills the command if it hasn't finished within this many seconds.",
				Default:     strconv.Itoa(defaultTimeoutSeconds),
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		re, err := lookupExecEnvFn(node.Config["envId"], secretAccessRunFromCtx(ctx))
		if err != nil {
			return ctx, fmt.Errorf("code-execution: %w", err)
		}

		script := ctx.Payload
		if node.Config["source"] == "literal" {
			script = node.Config["script"]
		}
		if strings.TrimSpace(script) == "" {
			return ctx, fmt.Errorf("code-execution: nothing to run (empty command)")
		}

		dir, err := resolveDir(re.Dir)
		if err != nil {
			return ctx, fmt.Errorf("code-execution: %w", err)
		}

		env := re.Env
		if len(env) == 0 {
			// A clean/empty Env still needs SOME PATH or the shell can't
			// resolve even coreutils -- ADR-0026's "materialize, don't
			// inherit" principle means this is a deliberate, minimal,
			// hardcoded default, never a fallback to os.Environ().
			env = []string{"PATH=/usr/bin:/bin:/usr/sbin:/sbin"}
		}

		timeout := defaultTimeoutSeconds * time.Second
		if raw := node.Config["timeoutSeconds"]; raw != "" {
			if n, err := strconv.Atoi(raw); err == nil && n > 0 {
				timeout = time.Duration(n) * time.Second
			}
		}

		var out strings.Builder
		handle, err := startProcessFn(procexec.Spec{
			Argv:        shellArgv(re.Shell, re.ProfileMode, script),
			Dir:         dir,
			Env:         env,
			HardTimeout: timeout,
			Output:      &out,
		})
		if err != nil {
			return ctx, fmt.Errorf("code-execution: start: %w", err)
		}

		unregister := registerRunningProcessFn(ctx.RunContext, node.ID, handle)
		defer unregister()

		result := handle.Wait()
		// A process started with a vault-resolved Env value (goal 0203
		// S1) could echo it back in its own stdout/stderr (a debug
		// trace, a crashing command dumping its environment) -- the
		// captured output is redacted against every currently-known
		// vault secret before it becomes ctx.Payload or reaches an
		// error message, mirroring mcp-tool-call's own redaction of its
		// subprocess-echoed error text (goal 0185 S4).
		outStr := redactSecretsFn(out.String())
		ctx.Payload = outStr

		switch result.Outcome {
		case procexec.OutcomeCancelled:
			return ctx, fmt.Errorf("code-execution: %w", errCancelledByUser)
		case procexec.OutcomeHardTimeout:
			return ctx, fmt.Errorf("code-execution: timed out after %s", timeout)
		case procexec.OutcomeIdleTimeout:
			return ctx, fmt.Errorf("code-execution: idle timeout (no output)")
		}
		if result.Err != nil {
			return ctx, fmt.Errorf("code-execution: %w", result.Err)
		}
		if result.ExitCode != 0 {
			return ctx, fmt.Errorf("code-execution: exit code %d: %s", result.ExitCode, outStr)
		}
		return ctx, nil
	})
}
