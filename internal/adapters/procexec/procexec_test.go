package procexec

import (
	"bytes"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

// groupAlive reports whether any process still shares pgid, using the
// signal(2) "signal 0" convention (no signal delivered, just an
// existence/permission check) -- the same mechanism killGroup itself
// uses, applied here in reverse to verify a kill actually took the
// whole group down, not just the leader.
func groupAlive(pgid int) bool {
	return syscall.Kill(-pgid, 0) == nil
}

// waitForGroupGone polls until groupAlive(pgid) is false or the
// deadline passes -- reaping a killed group isn't instantaneous, so a
// single immediate check would be flaky.
func waitForGroupGone(t *testing.T, pgid int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !groupAlive(pgid) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("process group %d still alive after waiting", pgid)
}

// readySignal is a Spec.Output sink that closes ready once marker has
// appeared in the accumulated bytes -- a fixed-duration time.Sleep
// standing in for "the child has finished some async setup" only ever
// guesses a long-enough interval; the child itself knows when the
// setup it just did (a trap installed, a background job forked) is
// done, so it prints marker and the test waits on THAT instead
// (goal 0358 S10). fanWriter (writer.go) serializes every Write behind
// its own mutex, so this type needs none of its own. marker may arrive
// split across separate Write calls (stdout is line-buffered in
// 4KB-ish chunks, not per-line) -- buf accumulates across calls so a
// split marker is still found.
type readySignal struct {
	marker []byte
	buf    []byte
	ready  chan struct{}
	closed bool
}

func newReadySignal(marker string) *readySignal {
	return &readySignal{marker: []byte(marker), ready: make(chan struct{})}
}

func (r *readySignal) Write(p []byte) (int, error) {
	if !r.closed {
		r.buf = append(r.buf, p...)
		if bytes.Contains(r.buf, r.marker) {
			r.closed = true
			close(r.ready)
		}
	}
	return len(p), nil
}

// waitReady blocks until marker has appeared in the child's output or
// timeout passes, failing the test loudly in the latter case rather
// than letting a caller silently race ahead on an un-signaled child.
func (r *readySignal) waitReady(t *testing.T, timeout time.Duration) {
	t.Helper()
	select {
	case <-r.ready:
	case <-time.After(timeout):
		t.Fatalf("child did not signal readiness: %q never appeared in its output", r.marker)
	}
}

func TestStart_EchoCapture(t *testing.T) {
	var out bytes.Buffer
	var startedPGID int

	h, err := Start(Spec{
		Argv:   []string{"echo", "hello from procexec"},
		Output: &out,
		OnStarted: func(pgid int) {
			startedPGID = pgid
		},
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	before := time.Now()
	result := h.Wait()

	if result.Outcome != OutcomeExited {
		t.Fatalf("Outcome = %q, want %q", result.Outcome, OutcomeExited)
	}
	if result.ExitCode != 0 {
		t.Fatalf("ExitCode = %d, want 0", result.ExitCode)
	}
	if result.Err != nil {
		t.Fatalf("Err = %v, want nil", result.Err)
	}
	if got := strings.TrimSpace(out.String()); got != "hello from procexec" {
		t.Fatalf("output = %q, want %q", got, "hello from procexec")
	}
	if startedPGID <= 0 {
		t.Fatalf("OnStarted pgid = %d, want a positive pgid", startedPGID)
	}
	if h.PGID() != startedPGID {
		t.Fatalf("PGID() = %d, want %d (same as OnStarted)", h.PGID(), startedPGID)
	}
	// Slew tolerance: the writer stamps wall-clock time (UnixNano
	// strips the monotonic reading), and NTP slew on a busy runner can
	// step the wall clock backwards by microseconds between `before`
	// and the stamp -- a 64us regression failed this exact assertion
	// in CI once. The property is "stamped at output time", not
	// nanosecond ordering.
	if h.LastOutputAt().Before(before.Add(-100 * time.Millisecond)) {
		t.Fatalf("LastOutputAt() = %v, want at/after %v", h.LastOutputAt(), before)
	}
}

func TestCancel_KillsWholeProcessGroup(t *testing.T) {
	// echo fires only after `&` has returned, and `&` returns only once
	// the shell has actually forked the background sleep -- so ready
	// signals a real second process now sits in the group, the fact
	// killGroup below must reach (not just the shell leader).
	ready := newReadySignal("ready\n")
	h, err := Start(Spec{
		Argv:   []string{"/bin/sh", "-c", "sleep 30 & echo ready; sleep 30"},
		Output: ready,
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	ready.waitReady(t, 2*time.Second)
	if !groupAlive(h.PGID()) {
		t.Fatalf("process group %d not alive before Cancel", h.PGID())
	}

	start := time.Now()
	h.Cancel()
	result := h.Wait()
	elapsed := time.Since(start)

	if result.Outcome != OutcomeCancelled {
		t.Fatalf("Outcome = %q, want %q", result.Outcome, OutcomeCancelled)
	}
	if elapsed > 2*time.Second {
		t.Fatalf("Cancel took %v to take effect, want well under the 2s default grace + margin", elapsed)
	}
	waitForGroupGone(t, h.PGID())
}

func TestHardTimeout(t *testing.T) {
	h, err := Start(Spec{
		Argv:        []string{"sleep", "30"},
		HardTimeout: 500 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	start := time.Now()
	result := h.Wait()
	elapsed := time.Since(start)

	if result.Outcome != OutcomeHardTimeout {
		t.Fatalf("Outcome = %q, want %q", result.Outcome, OutcomeHardTimeout)
	}
	if elapsed < 500*time.Millisecond {
		t.Fatalf("elapsed = %v, want at least the 500ms HardTimeout", elapsed)
	}
	if elapsed > 3*time.Second {
		t.Fatalf("elapsed = %v, want well under 3s (500ms timeout + grace + margin)", elapsed)
	}
	waitForGroupGone(t, h.PGID())
}

func TestIdleTimeout_KillsOnSilence(t *testing.T) {
	h, err := Start(Spec{
		Argv:        []string{"/bin/sh", "-c", "echo hi; sleep 30"},
		HardTimeout: 30 * time.Second, // safety net only, must not be what fires
		IdleTimeout: 500 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	start := time.Now()
	result := h.Wait()
	elapsed := time.Since(start)

	if result.Outcome != OutcomeIdleTimeout {
		t.Fatalf("Outcome = %q, want %q", result.Outcome, OutcomeIdleTimeout)
	}
	if elapsed > 3*time.Second {
		t.Fatalf("elapsed = %v, want well under 3s (idle timeout should fire promptly after the echo)", elapsed)
	}
	waitForGroupGone(t, h.PGID())
}

func TestIdleTimeout_ResetsOnRegularOutput_NoFalseKill(t *testing.T) {
	// Emits every 250ms for ~2.5s total -- always well under the 1s
	// idle timeout, so the idle timer must never fire; the process
	// should run to a natural, unforced exit.
	h, err := Start(Spec{
		Argv:        []string{"/bin/sh", "-c", "for i in 1 2 3 4 5 6 7 8 9 10; do echo tick; sleep 0.25; done"},
		HardTimeout: 10 * time.Second, // safety net only
		IdleTimeout: time.Second,
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	start := time.Now()
	result := h.Wait()
	elapsed := time.Since(start)

	if result.Outcome != OutcomeExited {
		t.Fatalf("Outcome = %q, want %q (idle timeout falsely fired)", result.Outcome, OutcomeExited)
	}
	if result.ExitCode != 0 {
		t.Fatalf("ExitCode = %d, want 0", result.ExitCode)
	}
	if elapsed < 2*time.Second {
		t.Fatalf("elapsed = %v, want at least ~2s (the loop's own runtime) -- test didn't actually exercise survival past 2s", elapsed)
	}
}

func TestEnvIsolation_NoAmbientInheritance(t *testing.T) {
	envBin, err := exec.LookPath("env")
	if err != nil {
		t.Skipf("no 'env' binary on PATH: %v", err)
	}

	var out bytes.Buffer
	h, err := Start(Spec{
		Argv:   []string{envBin},
		Env:    []string{"MILL_PROCEXEC_TEST=only-this"},
		Output: &out,
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	result := h.Wait()
	if result.Outcome != OutcomeExited || result.ExitCode != 0 {
		t.Fatalf("Result = %+v, want a clean exit", result)
	}

	got := strings.TrimSpace(out.String())
	if got != "MILL_PROCEXEC_TEST=only-this" {
		t.Fatalf("env output = %q, want exactly %q (no ambient inheritance)", got, "MILL_PROCEXEC_TEST=only-this")
	}
}

func TestDir_SetsWorkingDirectory(t *testing.T) {
	pwdBin, err := exec.LookPath("pwd")
	if err != nil {
		t.Skipf("no 'pwd' binary on PATH: %v", err)
	}
	dir := t.TempDir()

	var out bytes.Buffer
	h, err := Start(Spec{
		Argv:   []string{pwdBin},
		Dir:    dir,
		Env:    []string{},
		Output: &out,
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	result := h.Wait()
	if result.Outcome != OutcomeExited || result.ExitCode != 0 {
		t.Fatalf("Result = %+v, want a clean exit", result)
	}

	// Darwin-specific finding: t.TempDir() itself returns an
	// unresolved /var/folders/... path, but /bin/pwd (unlike a shell
	// builtin honoring $PWD) always physically resolves symlinks --
	// macOS's /var is itself a symlink to /private/var -- so the
	// child's real answer comes back as /private/var/folders/...
	// EvalSymlinks resolves the expected side the same way rather than
	// asserting a literal string match, which would be flaky
	// specifically on macOS.
	wantResolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatalf("EvalSymlinks(%q) error: %v", dir, err)
	}
	got := strings.TrimSpace(out.String())
	if got != wantResolved {
		t.Fatalf("pwd = %q, want %q (Dir %q resolved)", got, wantResolved, dir)
	}
}

func TestCancel_EscalatesToSIGKILL_WhenSIGTERMIsTrapped(t *testing.T) {
	// echo fires only once the preceding `trap` builtin has returned,
	// so ready signals the trap is actually installed -- Cancel racing
	// ahead of that point sends SIGTERM before the trap exists, and the
	// untrapped default handler kills the child immediately, timing the
	// test well under GracePeriod (the bug this test exists to catch).
	ready := newReadySignal("ready\n")
	h, err := Start(Spec{
		Argv:        []string{"/bin/sh", "-c", `trap "" TERM; echo ready; sleep 30`},
		GracePeriod: 300 * time.Millisecond,
		Output:      ready,
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	ready.waitReady(t, 2*time.Second)

	start := time.Now()
	h.Cancel()
	result := h.Wait()
	elapsed := time.Since(start)

	if result.Outcome != OutcomeCancelled {
		t.Fatalf("Outcome = %q, want %q", result.Outcome, OutcomeCancelled)
	}
	// Must have taken at least the grace period (SIGTERM was trapped
	// and ignored, so only the post-grace SIGKILL could have ended
	// it) but not much more.
	if elapsed < 300*time.Millisecond {
		t.Fatalf("elapsed = %v, want at least the 300ms grace period (SIGTERM was trapped, only SIGKILL could have killed it)", elapsed)
	}
	if elapsed > 2*time.Second {
		t.Fatalf("elapsed = %v, want well under 2s (300ms grace + margin)", elapsed)
	}
	waitForGroupGone(t, h.PGID())
}

// TestStart_StdinPipedToChild pins Spec.Stdin's contract (goal 0240
// S5): a non-empty Stdin reaches the child verbatim and is followed by
// EOF, so a stdin-reading command terminates on its own.
func TestStart_StdinPipedToChild(t *testing.T) {
	var out bytes.Buffer
	h, err := Start(Spec{
		Argv:   []string{"cat"},
		Stdin:  "line one\nline two\n",
		Output: &out,
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	result := h.Wait()
	if result.Outcome != OutcomeExited || result.ExitCode != 0 {
		t.Fatalf("Outcome/ExitCode = %q/%d, want exited/0", result.Outcome, result.ExitCode)
	}
	if got := out.String(); got != "line one\nline two\n" {
		t.Errorf("output = %q, want the stdin content verbatim", got)
	}
}

// TestStart_EmptyStdin_ChildSeesEOF pins the zero value's behavior:
// no Stdin means the child reads the null device (immediate EOF), the
// pre-S5 behavior unchanged.
func TestStart_EmptyStdin_ChildSeesEOF(t *testing.T) {
	var out bytes.Buffer
	h, err := Start(Spec{
		Argv:   []string{"cat"},
		Output: &out,
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	result := h.Wait()
	if result.Outcome != OutcomeExited || result.ExitCode != 0 {
		t.Fatalf("Outcome/ExitCode = %q/%d, want exited/0 (cat must see EOF, not hang)", result.Outcome, result.ExitCode)
	}
	if got := out.String(); got != "" {
		t.Errorf("output = %q, want empty", got)
	}
}
