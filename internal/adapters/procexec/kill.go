package procexec

import (
	"syscall"
	"time"
)

// setpgidAttr returns the SysProcAttr that puts a new process in its
// own process group -- shared by every Start call. POSIX
// (darwin+linux): confirmed the exact same SysProcAttr.Setpgid field
// exists under syscall on both, so this needs no build-tag split, only
// a plain function (kept here, next to the kill path it exists for,
// rather than in procexec.go, since the two only make sense read
// together).
func setpgidAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true}
}

// killGroup signals every process sharing pgid (the negative-pid
// convention: signal(2)'s own man page -- "If pid is less than -1,
// sig is sent to every process in the process group whose ID is
// -pid"). This is the whole reason Start puts the child in its own
// group: os.Process.Kill (and a bare SIGTERM to cmd.Process) only ever
// reaches the direct child, never a shell's own children, per Go's own
// os.Process.Kill doc ("only kills the Process itself, not any
// children it may have started"). Errors (already-gone process,
// permission) are deliberately not surfaced -- both Cancel and a
// timeout firing are best-effort requests to a process that may have
// already exited on its own, not a contract that something was alive
// to kill.
func killGroup(pgid int, sig syscall.Signal) {
	_ = syscall.Kill(-pgid, sig)
}

// trigger is the ONE kill path Cancel, a hard timeout, and an idle
// timeout all funnel through (docs/adr/0026's "one implementation,
// three triggers"). Only the first caller's outcome sticks (killOnce)
// -- whichever fires first wins the race to explain why the process
// died. If the process has already exited naturally by the time
// trigger runs (done already closed), this is a no-op: a late timer
// firing must never overwrite a legitimate OutcomeExited result with a
// forced one.
func (h *Handle) trigger(outcome Outcome) {
	h.killOnce.Do(func() {
		select {
		case <-h.done:
			return // already exited on its own; nothing to force
		default:
		}

		h.mu.Lock()
		h.forcedOutcome = outcome
		h.mu.Unlock()

		killGroup(h.pgid, syscall.SIGTERM)
		go h.escalate()
	})
}

// escalate is trigger's own follow-up: give the group h.grace to exit
// after SIGTERM, then SIGKILL it. This is the manual-escalation half of
// the ADR's named choice (Go 1.20's Cmd.Cancel/Cmd.WaitDelay vs manual
// escalation) -- manual was picked, not Cmd.Cancel, for two concrete
// reasons: (1) Cmd.Cancel's own default action is os.Process.Kill,
// which -- same doc warning as killGroup's above -- only reaches the
// direct child, not the process group SIGTERM/SIGKILL both need to
// target here; overriding Cancel to do a group-kill would still leave
// WaitDelay's own post-Cancel fallback-to-os.Kill(direct-child-only)
// racing it on top. (2) idle-timeout's reset-per-output-chunk timer
// has no single fixed deadline to hand to a context.Context the way
// Cmd.Cancel/WaitDelay expects -- it needs to be rearmed continuously
// (see watchIdle), which a one-shot context deadline can't express.
// A single hand-rolled escalate, shared by all three triggers via
// trigger, covers both needs with one code path instead of bolting a
// second manual mechanism onto Cmd.Cancel for idle alone.
func (h *Handle) escalate() {
	select {
	case <-h.done:
		return
	case <-time.After(h.grace):
		killGroup(h.pgid, syscall.SIGKILL)
	}
}

// watchHardTimeout fires trigger(OutcomeHardTimeout) once spec.HardTimeout
// elapses, unless the process has already exited.
func (h *Handle) watchHardTimeout(hardTimeout time.Duration) {
	defer h.wg.Done()
	timer := time.NewTimer(hardTimeout)
	defer timer.Stop()
	select {
	case <-h.done:
	case <-timer.C:
		h.trigger(OutcomeHardTimeout)
	}
}

// watchIdle fires trigger(OutcomeIdleTimeout) if idle elapses with no
// Output write in between -- the timer is rearmed on every write via
// h.output.notify (a coalesced, non-blocking signal channel; see
// writer.go), never a single fixed deadline, which is exactly the
// shape escalate's own doc comment above explains Cmd.Cancel/
// Cmd.WaitDelay can't express.
func (h *Handle) watchIdle(idle time.Duration) {
	defer h.wg.Done()
	timer := time.NewTimer(idle)
	defer timer.Stop()
	for {
		select {
		case <-h.done:
			return
		case <-h.output.notify:
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(idle)
		case <-timer.C:
			h.trigger(OutcomeIdleTimeout)
			return
		}
	}
}
