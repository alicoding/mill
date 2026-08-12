// Package procexec is the process supervisor DBOS deliberately isn't --
// docs/adr/0026-code-execution-capability.md's Amendment states the
// boundary explicitly: "DBOS owns workflow-state durability (what
// completed, with what result). It supervises NOTHING alive -- it
// cannot kill, observe, or time out a running process (confirmed from
// source; its own comment: executing steps are not interrupted).
// Everything alive is internal/adapters/procexec's job, full stop."
//
// This package owns exactly that: starting a command in its own POSIX
// process group (so a shell's grandchildren are reachable, not just the
// direct child -- os.Process.Kill's own doc warns it "only kills the
// Process itself"), streaming its combined stdout+stderr incrementally,
// and killing the whole group on three distinct triggers -- an explicit
// Cancel, a hard wall-clock timeout, or an idle (no-output-for-N)
// timeout -- through one shared kill path (see kill.go's trigger/
// escalate), never three separate ones.
//
// Deliberately build-tag-free: SysProcAttr.Setpgid and the negative-pid
// signal convention are POSIX behavior present under the same field/
// syscall names on both darwin and linux (Mill's only two supported
// execution platforms per docs/SPEC.md -- Windows execution is an
// explicit ADR-0026 non-goal), so no split is needed the way
// internal/adapters/hotkey needs one for a genuinely OS-specific API.
package procexec

import (
	"errors"
	"io"
	"os/exec"
	"sync"
	"time"
)

// Outcome is the terminal status of one Start call's process -- the
// ADR's status vocabulary, kept to exactly the four values this package
// itself can determine. "interrupted" (a crash-mid-step recovery
// finding an un-reaped attempt) is recorded one layer up, by the
// durable caller in the not-yet-built goal 0004b service layer -- this
// package has no durability of its own to recover from.
type Outcome string

const (
	// OutcomeExited means the process ran to completion on its own,
	// under any exit code -- the caller judges success/failure from
	// Result.ExitCode, this package never does.
	OutcomeExited Outcome = "exited"
	// OutcomeCancelled means Handle.Cancel was called.
	OutcomeCancelled Outcome = "cancelled"
	// OutcomeHardTimeout means Spec.HardTimeout elapsed.
	OutcomeHardTimeout Outcome = "hard-timeout"
	// OutcomeIdleTimeout means Spec.IdleTimeout elapsed with no Output
	// writes in between (the timer resets on every chunk).
	OutcomeIdleTimeout Outcome = "idle-timeout"
)

// defaultGrace is used when Spec.GracePeriod is zero -- the ADR names
// 2s as Cancel's own default grace between SIGTERM and SIGKILL.
const defaultGrace = 2 * time.Second

// Spec describes one command to run. The full command is Argv --
// assembling it (an ExecEnv's shell/profile-mode materialization) is
// goal 0004b's job at the service layer, not this package's; procexec
// only ever execs Argv[0] with Argv[1:] as its arguments, never a shell
// string it parses itself.
type Spec struct {
	// Argv is the full command: Argv[0] is the executable (resolved via
	// exec.LookPath's usual rules), Argv[1:] its arguments. Required,
	// non-empty.
	Argv []string

	// Dir is the process's working directory. Empty means the calling
	// process's own current directory (exec.Cmd's own default) -- Mill
	// callers are expected to always pass an explicit ExecEnv.Dir per
	// SPEC §6's pinned-cwd requirement; this package doesn't enforce
	// that itself, since it has no opinion on what a workflow node
	// requires, only on how to run what it's given.
	Dir string

	// Env is the child's exact environment -- explicit-only, never
	// ambient. A nil Env falls back to exec.Cmd's own documented
	// default (the *calling* process's real environment), which is
	// exactly the inheritance ADR-0026's "materialize, don't inherit"
	// principle exists to avoid -- callers that want a fully clean
	// environment must pass a non-nil, possibly-empty slice
	// ([]string{}), never leave this nil and rely on the fallback.
	Env []string

	// HardTimeout is the maximum wall-clock time the process may run
	// before it's killed with OutcomeHardTimeout. Zero disables it
	// (unbounded).
	HardTimeout time.Duration

	// IdleTimeout kills the process with OutcomeIdleTimeout if no byte
	// is written to Output for this long -- the timer resets on every
	// Output write, so a process that stays chatty can run past
	// IdleTimeout indefinitely (bounded only by HardTimeout, if set).
	// Zero disables it.
	IdleTimeout time.Duration

	// GracePeriod is how long Cancel/a timeout waits after SIGTERM
	// before escalating to SIGKILL. Zero uses defaultGrace (2s).
	GracePeriod time.Duration

	// OnStarted fires synchronously, once, immediately after the
	// process has been forked/exec'd and its process-group ID is known
	// -- before this call returns, Start has not yet begun consuming
	// any Output. This is the ADR's durable pre-spawn recording hook:
	// a caller records pgid durably here so a crash between spawn and
	// the first checkpoint still leaves an orphan-reapable trace
	// (Amendment point 3). May be nil.
	OnStarted func(pgid int)

	// Output receives every byte written to the process's stdout and
	// stderr, interleaved in real time as it's produced (a single fan
	// writer both streams share -- see writer.go). May be nil, in
	// which case output is discarded but LastOutputAt still advances
	// (idle-timeout tracking doesn't require a caller-supplied sink).
	Output io.Writer
}

// Result is one Start call's terminal outcome.
type Result struct {
	// Outcome is exactly one of the four package-level Outcome values.
	Outcome Outcome
	// ExitCode is the process's real exit code for OutcomeExited. For
	// a killed process (any other Outcome) it's whatever
	// os.ProcessState.ExitCode reports for a signal-terminated
	// process, which is always -1 per its own doc -- callers should
	// key off Outcome, not ExitCode, to distinguish a kill from a
	// natural non-zero exit.
	ExitCode int
	// Err is non-nil only for an unexpected failure distinct from a
	// normal (possibly non-zero) exit -- e.g. the OS refusing to reap
	// the process. A normal non-zero exit is reported via ExitCode
	// with Err nil; the caller judges success from ExitCode, per the
	// ADR's "non-zero exit fails the step" being the caller's
	// business, not this package's.
	Err error
}

// Handle is a running (or finished) process started by Start.
type Handle struct {
	cmd    *exec.Cmd
	pgid   int
	output *fanWriter
	grace  time.Duration

	done chan struct{}  // closed once cmd.Wait() has returned
	wg   sync.WaitGroup // guards the hard-timeout/idle-watch goroutines exiting before Wait returns

	killOnce sync.Once

	mu            sync.Mutex
	forcedOutcome Outcome // "" until Cancel/a timeout fires
	waitErr       error
}

// Start forks/execs spec.Argv in its own process group and begins
// streaming its output. It returns once the process has successfully
// started (or failed to start at all -- a pre-spawn failure, e.g. the
// executable not found, is returned directly here with no Handle,
// since there is nothing yet to supervise).
func Start(spec Spec) (*Handle, error) {
	if len(spec.Argv) == 0 {
		return nil, errors.New("procexec: Spec.Argv must not be empty")
	}

	grace := spec.GracePeriod
	if grace <= 0 {
		grace = defaultGrace
	}

	// Deliberately exec.Command, not exec.CommandContext: this package's
	// own doc above states its whole reason for existing -- it owns
	// process supervision itself (graceful signal, then escalate to
	// SIGKILL after GracePeriod, via kill.go's process-group kill), never
	// a context's own immediate cancel-means-SIGKILL. Wiring a context in
	// here would fight that design, not fix a gap.
	cmd := exec.Command(spec.Argv[0], spec.Argv[1:]...) //nolint:gosec,noctx // Argv is caller-controlled per Spec's own doc, and lifecycle is this package's own job (see comment above)
	cmd.Dir = spec.Dir
	cmd.Env = spec.Env
	cmd.SysProcAttr = setpgidAttr()

	fw := newFanWriter(spec.Output)
	cmd.Stdout = fw
	cmd.Stderr = fw

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	pgid := cmd.Process.Pid // Setpgid with no explicit Pgid makes the new process its own group leader, so pgid == its pid
	if spec.OnStarted != nil {
		spec.OnStarted(pgid)
	}

	h := &Handle{
		cmd:    cmd,
		pgid:   pgid,
		output: fw,
		grace:  grace,
		done:   make(chan struct{}),
	}

	h.wg.Add(1)
	go h.supervise()

	if spec.HardTimeout > 0 {
		h.wg.Add(1)
		go h.watchHardTimeout(spec.HardTimeout)
	}
	if spec.IdleTimeout > 0 {
		h.wg.Add(1)
		go h.watchIdle(spec.IdleTimeout)
	}

	return h, nil
}

// supervise blocks on the process actually exiting (naturally or via a
// kill from trigger), then closes done -- every other goroutine in this
// package selects on done to know the process is gone.
func (h *Handle) supervise() {
	defer h.wg.Done()
	err := h.cmd.Wait()
	h.mu.Lock()
	h.waitErr = err
	h.mu.Unlock()
	close(h.done)
}

// Wait blocks until the process exits (naturally or killed) and
// returns its terminal Result. Safe to call more than once, or
// concurrently with Cancel.
func (h *Handle) Wait() Result {
	<-h.done
	h.wg.Wait() // let the hard-timeout/idle-watch goroutines observe done and return before we read forcedOutcome

	h.mu.Lock()
	outcome := h.forcedOutcome
	waitErr := h.waitErr
	h.mu.Unlock()

	code := -1
	if h.cmd.ProcessState != nil {
		code = h.cmd.ProcessState.ExitCode()
	}

	if outcome != "" {
		return Result{Outcome: outcome, ExitCode: code, Err: nil}
	}

	var exitErr *exec.ExitError
	if waitErr != nil && !errors.As(waitErr, &exitErr) {
		// cmd.Wait failed for a reason other than a non-zero exit
		// (e.g. the OS refused to reap it) -- a real error, not a
		// judged exit code.
		return Result{Outcome: OutcomeExited, ExitCode: code, Err: waitErr}
	}
	return Result{Outcome: OutcomeExited, ExitCode: code, Err: nil}
}

// Cancel requests the process (and its whole process group) be killed:
// SIGTERM immediately, SIGKILL after Handle's grace period if it hasn't
// exited by then. Safe to call more than once and safe to call after
// the process has already exited (a no-op in that case). Does not
// block -- call Wait to observe the outcome.
func (h *Handle) Cancel() {
	h.trigger(OutcomeCancelled)
}

// LastOutputAt returns the timestamp of the most recent byte written to
// Spec.Output (stdout or stderr, either counts), or the zero time if
// nothing has been written yet. This is the ADR's "silence duration is
// the stuck signal" liveness primitive -- a caller renders
// time.Since(LastOutputAt()) as "no output for Ns" alongside overall
// elapsed time.
func (h *Handle) LastOutputAt() time.Time {
	return h.output.LastOutputAt()
}

// PGID returns the process group ID the command was started in -- the
// same value already delivered to Spec.OnStarted, exposed here too so
// a caller that didn't need it at spawn time (e.g. a test) can still
// read it.
func (h *Handle) PGID() int {
	return h.pgid
}
