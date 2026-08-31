// Package clipboard wraps macOS clipboard I/O behind Mill's own names, so
// swapping the underlying mechanism (osascript today) never touches domain
// logic — the CLAUDE.md ports/adapters rule applied to this one commodity
// concern.
package clipboard

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// cmdTimeout bounds every osascript/pbcopy/pbpaste invocation below --
// same fail-safe reasoning as mcpclient's own timeout const (docs/SPEC.md
// §8): a hung clipboard subprocess must not hang its caller indefinitely.
const cmdTimeout = 5 * time.Second

// ReadHTML asks macOS for the HTML flavor of the current clipboard
// contents. AppleScript returns raw AppleEvent data as a hex-encoded
// "«data HTMLxxxx»" literal, so it needs unwrapping before it's usable HTML.
func ReadHTML() (string, error) {
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
func WriteHTML(html string) error {
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
// records text as Mill's own most recent programmatic write (see
// ConsumeSelfWrite) -- goal 0234's self-echo guard: a clipboard-history
// trigger polling right after this call must be able to tell "the
// content changed because Mill just wrote it" from "the user copied
// something new."
func WriteText(text string) error {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "pbcopy")
	cmd.Stdin = strings.NewReader(text)
	if err := cmd.Run(); err != nil {
		return err
	}
	markSelfWrite(text)
	return nil
}

// selfWriteMu/selfWriteText track the most recent WriteText call's own
// content -- a plain package var, not per-caller state, since the
// clipboard itself is one shared, singular resource on the machine.
var (
	selfWriteMu   sync.Mutex
	selfWriteText string
)

func markSelfWrite(text string) {
	selfWriteMu.Lock()
	selfWriteText = text
	selfWriteMu.Unlock()
}

// ConsumeSelfWrite reports whether text matches Mill's own most recent
// WriteText call, clearing the marker on a match. One-shot by design:
// only the poll cycle immediately following a self-write is treated as
// an echo -- a later, separate user copy of identical text is recorded
// normally rather than permanently blacklisted.
func ConsumeSelfWrite(text string) bool {
	selfWriteMu.Lock()
	defer selfWriteMu.Unlock()
	if selfWriteText != "" && selfWriteText == text {
		selfWriteText = ""
		return true
	}
	return false
}

// ReadText reads the clipboard's plain-text flavor via pbpaste.
func ReadText() (string, error) {
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
func Info() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "osascript", "-e", "clipboard info").Output()
	if err != nil {
		return "", fmt.Errorf("clipboard info failed: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

// WatchChanges polls the clipboard's plain-text flavor on the given
// interval and calls fn with the new text whenever it differs from the
// last-seen value. Build, not adopt -- confirmed no clipboard-changed
// event exists via osascript (docs/SPEC.md §3.4), so this is the same
// poll-loop shape every clipboard manager uses under the hood (goal
// 0234's own research: changeCount polling is the converged mechanism,
// and unlike a content read it triggers no macOS pasteboard-privacy
// prompt on any shipping release). Plain text, not HTML: the HTML
// flavor is frequently absent (e.g. copying a filename or plain text
// produces none, and ReadHTML errors in that case), so watching it
// would miss most real clipboard activity -- text is the one flavor
// almost everything copyable sets.
func WatchChanges(interval time.Duration, fn func(text string)) (stop func()) {
	done := make(chan struct{})
	go func() {
		last, _ := ReadText() // baseline; ignore error (nothing on clipboard yet)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				text, err := ReadText()
				if err != nil {
					continue
				}
				if text != last {
					last = text
					// A transition to EMPTY never fires: pbcopy's own
					// clear-then-set exposes a transient empty pasteboard
					// to a concurrent poll (measured live: baseline ->
					// "" -> new value at a 20ms interval), and a
					// non-text clipboard (an image copy) also reads as
					// empty -- neither is a text change worth capturing.
					if text != "" {
						fn(text)
					}
				}
			case <-done:
				return
			}
		}
	}()
	return func() { close(done) }
}

// Types returns every registered pasteboard type's UTI string, via a
// JXA (osascript -l JavaScript) bridge directly into NSPasteboard --
// AppleScript's own "clipboard info" command (Info, above) only reports
// coarse four-char AppleScript classes, not arbitrary UTIs like
// org.nspasteboard.ConcealedType, so checking for those needs Cocoa's
// own types array instead.
func Types() ([]string, error) {
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
func ReadFileURLs() ([]string, error) {
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

// concealedTypes are the nspasteboard.org convention's own markers
// (https://nspasteboard.org) a password manager or transient-content
// source sets on the pasteboard to declare "don't record this in a
// clipboard history" -- the same three types Maccy itself checks
// (goal 0234's own research).
var concealedTypes = []string{
	"org.nspasteboard.ConcealedType",
	"org.nspasteboard.TransientType",
	"org.nspasteboard.AutoGeneratedType",
}

// IsConcealed reports whether the clipboard's current content carries
// one of concealedTypes' UTIs -- checked before any content read
// reaches a capture, so concealed content never enters clipboard
// history at all.
func IsConcealed() (bool, error) {
	types, err := Types()
	if err != nil {
		return false, err
	}
	for _, t := range types {
		for _, c := range concealedTypes {
			if t == c {
				return true, nil
			}
		}
	}
	return false, nil
}
