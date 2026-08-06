package clipboard

import (
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
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
}

func TestWriteText(t *testing.T) {
	skipUnlessRealDesktop(t)

	const text = "mill clipboard adapter test"
	if err := WriteText(text); err != nil {
		t.Fatalf("WriteText() error: %v", err)
	}

	out, err := exec.Command("pbpaste").Output()
	if err != nil {
		t.Fatalf("pbpaste failed while verifying WriteText(): %v", err)
	}
	if strings.TrimSpace(string(out)) != text {
		t.Errorf("pbpaste after WriteText(%q) = %q", text, string(out))
	}
}
