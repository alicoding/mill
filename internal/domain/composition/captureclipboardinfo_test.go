package composition

import (
	"errors"
	"strings"
	"testing"
)

// formatClipboardInfo is pure and independently tested against fixture
// strings shaped like real "clipboard info" output -- the real
// pasteboard round trip itself isn't CI-testable (see
// internal/adapters/clipboard's own policy), so this is the layer that
// actually proves the presence-check/formatting logic.

func TestFormatClipboardInfo_BothFlavorsPresent(t *testing.T) {
	raw := `«class utf8», 12, «class HTML», 14, string, 12`
	got := formatClipboardInfo(raw)
	if !strings.HasPrefix(got, "HTML flavor present: yes\nPlain text present: yes\n\n") {
		t.Fatalf("formatClipboardInfo() = %q, want it to lead with both yes", got)
	}
	if !strings.HasSuffix(got, raw) {
		t.Errorf("formatClipboardInfo() = %q, want it to end with the raw report verbatim", got)
	}
}

func TestFormatClipboardInfo_HTMLAbsent(t *testing.T) {
	raw := `string, 20, «class utf8», 20`
	got := formatClipboardInfo(raw)
	if !strings.HasPrefix(got, "HTML flavor present: no\nPlain text present: yes\n\n") {
		t.Fatalf("formatClipboardInfo() = %q, want HTML absent, text present", got)
	}
}

func TestFormatClipboardInfo_NeitherFlavor(t *testing.T) {
	raw := `«class PNGf», 4096`
	got := formatClipboardInfo(raw)
	if !strings.HasPrefix(got, "HTML flavor present: no\nPlain text present: no\n\n") {
		t.Fatalf("formatClipboardInfo() = %q, want both no", got)
	}
}

// TestCaptureClipboardInfo_NodeExec_UsesTheInjectedSeam proves the node
// itself calls the package-level seam and formats its result -- the
// real osascript round trip stays covered manually/desktop-only.
func TestCaptureClipboardInfo_NodeExec_UsesTheInjectedSeam(t *testing.T) {
	orig := clipboardInfoFn
	t.Cleanup(func() { clipboardInfoFn = orig })

	clipboardInfoFn = func() (string, error) { return `«class utf8», 5, «class HTML», 9`, nil }

	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "c", NodeTypeID: "capture-clipboard-info"},
	})
	if err != nil {
		t.Fatal(err)
	}
	edges := []Edge{{ID: "e", Source: "t", Target: "c"}}

	out, err := ExecuteWorkflow(nodes, edges, nil)
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if !strings.Contains(out, "HTML flavor present: yes") {
		t.Errorf("output = %q, want it to report HTML present", out)
	}

	clipboardInfoFn = func() (string, error) { return "", errors.New("no pasteboard session") }
	if _, err := ExecuteWorkflow(nodes, edges, nil); err == nil {
		t.Fatal("ExecuteWorkflow() error = nil, want the clipboard.Info() error to surface")
	}
}
