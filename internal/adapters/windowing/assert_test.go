package windowing

import (
	"log/slog"
	"strings"
	"testing"
)

// TestReportThreadViolation_OnMainThread_NeverFiresEitherPosture pins
// the pass case: a correctly-marshaled call never panics and never
// logs, dev or release.
func TestReportThreadViolation_OnMainThread_NeverFiresEitherPosture(t *testing.T) {
	for _, release := range []bool{false, true} {
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("release=%v: unexpected panic on the main thread: %v", release, r)
				}
			}()
			reportThreadViolation(true, release, "windowing.Test")
		}()
	}
}

// TestReportThreadViolation_DevBuild_PanicsOnViolation pins the
// JavaFX-style posture (docs/goals/0168): a dev/test build panics on a
// wrong-thread platform call, naming the call site.
func TestReportThreadViolation_DevBuild_PanicsOnViolation(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected a panic on a dev-build thread violation, got none")
		}
		msg, ok := r.(string)
		if !ok || !strings.Contains(msg, "windowing.Test") {
			t.Fatalf("panic message %q does not name the call site", r)
		}
	}()
	reportThreadViolation(false, false, "windowing.Test")
}

// TestReportThreadViolation_ReleaseBuild_LogsAndReturns pins the
// self-heal posture: a release build never panics on a wrong-thread
// call -- it logs the call site (naming it) and returns, so the
// caller's own marshal (already in flight by the time this runs,
// mainthread.go's runMainThreadAction) completes the call correctly.
func TestReportThreadViolation_ReleaseBuild_LogsAndReturns(t *testing.T) {
	var buf strings.Builder
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	defer slog.SetDefault(prev)

	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("unexpected panic on a release build: %v", r)
			}
		}()
		reportThreadViolation(false, true, "windowing.Test")
	}()

	if !strings.Contains(buf.String(), "windowing.Test") {
		t.Fatalf("expected the release-mode log to name the call site, got: %s", buf.String())
	}
}
