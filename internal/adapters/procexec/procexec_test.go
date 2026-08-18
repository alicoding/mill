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
	var out bytes.Buffer
	h, err := Start(Spec{
		Argv:   []string{"/bin/sh", "-c", "sleep 30 & sleep 30"},
		Output: &out,
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// Give the shell a moment to actually fork its background sleep
	// before cancelling, so there's a real second process in the group
	// to prove killGroup reaches (not just the shell leader).
	time.Sleep(150 * time.Millisecond)
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
	h, err := Start(Spec{
		Argv:        []string{"/bin/sh", "-c", `trap "" TERM; sleep 30`},
		GracePeriod: 300 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// Let the trap actually install before cancelling.
	time.Sleep(150 * time.Millisecond)

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
