package procexec

import (
	"time"
)

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

		terminateProcessGroup(h.pgid)
		go h.escalate()
	})
}

// escalate is trigger's own follow-up: give the group h.grace to exit
// after SIGTERM, then SIGKILL it. This is the manual-escalation half of
// the ADR's named choice (Go 1.20's Cmd.Cancel/Cmd.WaitDelay vs manual
// escalation) -- manual was picked, not Cmd.Cancel, for two concrete
// reasons: (1) Cmd.Cancel's own default action is os.Process.Kill,
// which -- same doc warning as the package overview -- only reaches
// the direct child, not the process group SIGTERM/SIGKILL both need to
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
		forceKillProcessGroup(h.pgid)
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
