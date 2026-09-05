package clipboard

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// cmdTimeout bounds every osascript/pbcopy/pbpaste invocation below --
// same fail-safe reasoning as mcpclient's own timeout const (docs/SPEC.md
// §8): a hung clipboard subprocess must not hang its caller indefinitely.
const cmdTimeout = 5 * time.Second

// Host is the real macOS pasteboard, reached through osascript/pbcopy/
// pbpaste — the only Port implementation that touches anything outside
// this process.
type Host struct {
	selfWriteTracker
}

// NewHost constructs the real pasteboard adapter. It panics if called
// from inside a `go test` binary (testing.Testing()) unless the caller
// has set MILL_CLIPBOARD_HOST_OK=1 first — goal 0356's guard against the
// exact defect that motivated this package: a seeded workflow test's
// own apply-clipboard-write step silently landed on the machine running
// the test. The one legitimate case (this package's own real-desktop
// round-trip tests, clipboard_test.go/host_png_test.go) sets the
// environment variable itself, right before constructing, as a
// deliberate opt-in rather than an accident.
func NewHost() *Host {
	if testing.Testing() && os.Getenv("MILL_CLIPBOARD_HOST_OK") != "1" {
		panic("clipboard: refusing to construct the real pasteboard adapter inside a go test binary; set MILL_CLIPBOARD_HOST_OK=1 for a deliberate real-pasteboard test")
	}
	return &Host{}
}

// ReadHTML asks macOS for the HTML flavor of the current clipboard
// contents. AppleScript returns raw AppleEvent data as a hex-encoded
// "«data HTMLxxxx»" literal, so it needs unwrapping before it's usable HTML.
func (h *Host) ReadHTML() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "osascript", "-e", "the clipboard as «class HTML»").Output()
	if err != nil {
		return "", fmt.Errorf("no HTML on clipboard: %w", err)
	}

	raw := strings.TrimSpace(string(out))
	raw = strings.TrimPrefix(raw, "«data HTML")
	raw = strings.TrimSuffix(raw, "»")

	decoded, err := hex.DecodeString(raw)
	if err != nil {
		return "", fmt.Errorf("could not decode clipboard HTML: %w", err)
	}
	return string(decoded), nil
}

// WriteHTML is the inverse of ReadHTML: AppleScript sets the clipboard's
// HTML flavor from a hex-encoded "«data HTMLxxxx»" literal, the same
// encoding it hands back when reading.
func (h *Host) WriteHTML(html string) error {
	// script is built entirely from a hex encoding of html, which by
	// construction contains only [0-9a-f] -- there is no AppleScript
	// metacharacter (a literal «, », or quote) html's raw bytes could
	// ever inject into the assembled script.
	script := "set the clipboard to «data HTML" + hex.EncodeToString([]byte(html)) + "»"
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	if err := exec.CommandContext(ctx, "osascript", "-e", script).Run(); err != nil { //nolint:gosec // script is hex-encoded (see above), no injectable characters possible
		return fmt.Errorf("osascript set-clipboard failed: %w", err)
	}
	return nil
}

// WriteText sets the clipboard's plain-text flavor via pbcopy, and
// records text as this Port's own most recent programmatic write (see
// ConsumeSelfWrite) -- goal 0234's self-echo guard: a clipboard-history
// trigger polling right after this call must be able to tell "the
// content changed because Mill just wrote it" from "the user copied
// something new."
func (h *Host) WriteText(text string) error {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "pbcopy")
	cmd.Stdin = strings.NewReader(text)
	if err := cmd.Run(); err != nil {
		return err
	}
	h.markSelfWrite(text)
	return nil
}

// ReadText reads the clipboard's plain-text flavor via pbpaste.
func (h *Host) ReadText() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "pbpaste").Output()
	if err != nil {
		return "", fmt.Errorf("pbpaste failed: %w", err)
	}
	return string(out), nil
}

// Info returns macOS's own raw "clipboard info" report -- a
// comma-separated list of alternating «class XXXX», byte-size pairs
// naming every flavor currently on the pasteboard (e.g. "«class
// utf8», 12, «class HTML», 14"). Unlike ReadHTML/ReadText, which each
// commit to one flavor and fail if it's absent, this is a diagnostic:
// "what's actually on the clipboard right now, and in what shapes" --
// the same «class HTML»/plain-text presence question §5's capture
// fallback order already has to answer implicitly, made directly
// inspectable.
func (h *Host) Info() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "osascript", "-e", "clipboard info").Output()
	if err != nil {
		return "", fmt.Errorf("clipboard info failed: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

// WatchChanges polls the real pasteboard's plain-text flavor; see
// watchChanges' own doc comment for the shared poll/dedup logic.
func (h *Host) WatchChanges(interval time.Duration, fn func(text string)) (stop func()) {
	return watchChanges(interval, fn, h.ReadText)
}

// Types returns every registered pasteboard type's UTI string, via a
// JXA (osascript -l JavaScript) bridge directly into NSPasteboard --
// AppleScript's own "clipboard info" command (Info, above) only reports
// coarse four-char AppleScript classes, not arbitrary UTIs like
// org.nspasteboard.ConcealedType, so checking for those needs Cocoa's
// own types array instead.
func (h *Host) Types() ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	const script = `ObjC.import('AppKit'); JSON.stringify(ObjC.deepUnwrap($.NSPasteboard.generalPasteboard.types))`
	out, err := exec.CommandContext(ctx, "osascript", "-l", "JavaScript", "-e", script).Output()
	if err != nil {
		return nil, fmt.Errorf("osascript pasteboard types failed: %w", err)
	}
	var types []string
	if err := json.Unmarshal(out, &types); err != nil {
		return nil, fmt.Errorf("decode pasteboard types: %w", err)
	}
	return types, nil
}

// ReadFileURLs returns the absolute filesystem paths of any files on
// the pasteboard (a Finder ⌘C), via the same JXA/NSPasteboard bridge
// Types uses -- the web Clipboard API exposes a pasted file's BYTES
// but never its real path, so the board's paste door has to ask the
// host for the paths a file drop would have delivered. Empty (with the
// error) wherever osascript is absent or no file flavor exists --
// callers treat any error as "no files", never a user-facing failure.
func (h *Host) ReadFileURLs() ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	const script = `ObjC.import('AppKit');
const pb = $.NSPasteboard.generalPasteboard;
const out = [];
const items = pb.pasteboardItems;
for (let i = 0; i < items.count; i++) {
  const s = items.objectAtIndex(i).stringForType('public.file-url');
  if (!s.isNil()) {
    const u = $.NSURL.URLWithString(s);
    if (!u.isNil() && !u.path.isNil()) out.push(ObjC.unwrap(u.path));
  }
}
JSON.stringify(out)`
	out, err := exec.CommandContext(ctx, "osascript", "-l", "JavaScript", "-e", script).Output()
	if err != nil {
		return nil, fmt.Errorf("osascript pasteboard file urls failed: %w", err)
	}
	var paths []string
	if err := json.Unmarshal(out, &paths); err != nil {
		return nil, fmt.Errorf("decode pasteboard file urls: %w", err)
	}
	return paths, nil
}

// IsConcealed reports whether the clipboard's current content carries
// one of concealedTypes' UTIs -- checked before any content read
// reaches a capture, so concealed content never enters clipboard
// history at all.
func (h *Host) IsConcealed() (bool, error) {
	types, err := h.Types()
	if err != nil {
		return false, err
	}
	return isConcealedIn(types), nil
}
