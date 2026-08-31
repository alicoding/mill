package clipboard

import (
	"context"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/clipboard/clipboardtest"
)

// These hit the real macOS clipboard via osascript/pbcopy/pbpaste -- per
// ADR-0002, a mock here would prove nothing about the one thing that can
// actually break (macOS clipboard flavor handling), so this is a real
// round-trip, not a fake. It does overwrite whatever's currently on the
// clipboard, same tradeoff as the run-mill skill's own manual check.
func skipUnlessRealDesktop(t *testing.T) {
	t.Helper()
	if runtime.GOOS != "darwin" {
		t.Skip("clipboard adapter is macOS-only (osascript/pbcopy); skipping on " + runtime.GOOS)
	}
	if os.Getenv("CI") != "" {
		t.Skip("skipping real clipboard round-trip in CI: GitHub's macos-latest runners are headless (no GUI/pasteboard session), so osascript/pbcopy fail there even on darwin -- covered by the manual run-mill check instead, per ADR-0002")
	}
}

func TestWriteHTML_ReadHTML_RoundTrip(t *testing.T) {
	skipUnlessRealDesktop(t)

	clipboardtest.WithRealClipboardLock(func() {
		const html = `<h2>round-trip</h2><p>the <strong>bit</strong></p>`
		if err := WriteHTML(html); err != nil {
			t.Fatalf("WriteHTML() error: %v", err)
		}

		got, err := ReadHTML()
		if err != nil {
			t.Fatalf("ReadHTML() error: %v", err)
		}
		if !strings.Contains(got, "round-trip") || !strings.Contains(got, "<strong>bit</strong>") {
			t.Errorf("ReadHTML() = %q, want it to contain what WriteHTML() just wrote", got)
		}
	})
}

func TestWriteText(t *testing.T) {
	skipUnlessRealDesktop(t)

	clipboardtest.WithRealClipboardLock(func() {
		const text = "mill clipboard adapter test"
		if err := WriteText(text); err != nil {
			t.Fatalf("WriteText() error: %v", err)
		}

		ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
		defer cancel()
		out, err := exec.CommandContext(ctx, "pbpaste").Output()
		if err != nil {
			t.Fatalf("pbpaste failed while verifying WriteText(): %v", err)
		}
		if strings.TrimSpace(string(out)) != text {
			t.Errorf("pbpaste after WriteText(%q) = %q", text, string(out))
		}
	})
}

func TestWatchChanges_FiresOnRealChange(t *testing.T) {
	skipUnlessRealDesktop(t)

	clipboardtest.WithRealClipboardLock(func() {
		if err := WriteText("watch-changes-baseline"); err != nil {
			t.Fatalf("WriteText(baseline) error: %v", err)
		}

		fired := make(chan string, 1)
		stop := WatchChanges(20*time.Millisecond, func(text string) {
			select {
			case fired <- text:
			default:
			}
		})
		defer stop()

		// Give the watch loop time to read the baseline before changing it --
		// otherwise the very first poll could race the baseline read below
		// and misfire on what should be the established starting value.
		time.Sleep(50 * time.Millisecond)

		if err := WriteText("watch-changes-new-value"); err != nil {
			t.Fatalf("WriteText(new value) error: %v", err)
		}

		select {
		case got := <-fired:
			if got != "watch-changes-new-value" {
				t.Errorf("WatchChanges fired with text %q, want the new clipboard value", got)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("WatchChanges never fired after the clipboard changed")
		}
	})
}

func TestIsConcealed_FalseForPlainText(t *testing.T) {
	skipUnlessRealDesktop(t)

	clipboardtest.WithRealClipboardLock(func() {
		if err := WriteText("plain clipboard content"); err != nil {
			t.Fatalf("WriteText() error: %v", err)
		}
		concealed, err := IsConcealed()
		if err != nil {
			t.Fatalf("IsConcealed() error: %v", err)
		}
		if concealed {
			t.Error("IsConcealed() = true for plain pbcopy'd text, want false")
		}
	})
}

func TestIsConcealed_TrueForConcealedTypeMarker(t *testing.T) {
	skipUnlessRealDesktop(t)

	clipboardtest.WithRealClipboardLock(func() {
		// Sets the pasteboard directly via JXA, the same bridge Types() uses,
		// with a real plain-text item PLUS the org.nspasteboard.ConcealedType
		// marker -- exactly the shape a password manager sets, per
		// nspasteboard.org's own spec.
		const script = `
ObjC.import('AppKit');
var pb = $.NSPasteboard.generalPasteboard;
pb.clearContents;
pb.setStringForType('secret value', 'public.utf8-plain-text');
pb.setStringForType('1', 'org.nspasteboard.ConcealedType');
`
		ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
		defer cancel()
		if err := exec.CommandContext(ctx, "osascript", "-l", "JavaScript", "-e", script).Run(); err != nil {
			t.Fatalf("set concealed pasteboard item via JXA: %v", err)
		}

		concealed, err := IsConcealed()
		if err != nil {
			t.Fatalf("IsConcealed() error: %v", err)
		}
		if !concealed {
			t.Error("IsConcealed() = false for a pasteboard item carrying org.nspasteboard.ConcealedType, want true")
		}
	})
}

func TestConsumeSelfWrite_OneShotMatch(t *testing.T) {
	markSelfWrite("self-written text")

	if !ConsumeSelfWrite("self-written text") {
		t.Error("ConsumeSelfWrite() = false for text matching the last self-write, want true")
	}
	if ConsumeSelfWrite("self-written text") {
		t.Error("ConsumeSelfWrite() = true on a SECOND call with the same text, want false (one-shot)")
	}
}

func TestConsumeSelfWrite_NoMatchLeavesMarkerIntact(t *testing.T) {
	markSelfWrite("expected value")

	if ConsumeSelfWrite("different value") {
		t.Error("ConsumeSelfWrite() = true for unrelated text, want false")
	}
	if !ConsumeSelfWrite("expected value") {
		t.Error("ConsumeSelfWrite() = false for the actual self-written text after a non-matching call, want true (marker must survive a non-match)")
	}
}

// ReadFileURLs must fail closed where osascript is unavailable (a CI
// runner, a stripped PATH) -- the paste door treats any error as "no
// files on the pasteboard", so the error must actually surface rather
// than a panic or a fabricated result.
func TestReadFileURLs_FailsClosedWithoutOsascript(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	paths, err := ReadFileURLs()
	if err == nil {
		t.Fatal("ReadFileURLs() with no osascript on PATH: expected an error")
	}
	if paths != nil {
		t.Fatalf("ReadFileURLs() with no osascript on PATH: paths = %v, want nil", paths)
	}
}
