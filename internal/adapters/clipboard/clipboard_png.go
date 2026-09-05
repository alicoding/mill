package clipboard

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// framework-api-audit: wails/v3@v3.0.0-beta.12 lacks image clipboard write
//
// The vendored SDK's whole clipboard surface is
// application.Clipboard{SetText, Text} over a clipboardImpl of
// {setText, text} (pkg/application/clipboard.go, clipboard_darwin.go):
// NSPasteboardTypeString only, with no image/data flavor on any
// platform impl. So an image copy has to reach NSPasteboard directly,
// through the SAME JXA/AppKit bridge Types and ReadFileURLs already
// use rather than a second mechanism.
//
// The bytes travel via a temp FILE, not the script text: an osascript
// -e argument is a process argument, so inlining even a base64 PNG
// would put a multi-hundred-KB payload through ARG_MAX and the shell's
// own quoting. The path reaches the script through the ENVIRONMENT,
// never string-interpolated into it, so no path can inject JavaScript.

// pngPathEnv names the temp file to the JXA bridge below.
const pngPathEnv = "MILL_CLIPBOARD_PNG_PATH"

// pngPasteboardType is NSPasteboardTypePNG's own value. Spelled as the
// UTI literal because JXA resolves an AppKit *constant* only when the
// framework's symbol is bridged, while a plain string is always a
// valid NSPasteboard type argument.
const pngPasteboardType = "public.png"

// writePNGScript sets data on the general pasteboard and reports
// setData:forType:'s own success, so a silent no-op can never read as
// a successful copy.
const writePNGScript = `ObjC.import('AppKit');
const path = ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('` + pngPathEnv + `'));
const data = $.NSData.dataWithContentsOfFile(path);
if (data.isNil()) throw new Error('unreadable png file');
const pb = $.NSPasteboard.generalPasteboard;
pb.clearContents;
JSON.stringify(pb.setDataForType(data, '` + pngPasteboardType + `'))`

// WritePNG puts data on the macOS pasteboard under the PNG flavor, so
// a paste into any image-accepting app receives the picture rather
// than a filename or nothing at all. data must be the PNG bytes
// themselves.
//
// Unlike WriteText this leaves no self-write marker: the
// clipboard-history poller watches the TEXT flavor only, so an image
// write is invisible to it by construction.
func WritePNG(data []byte) error {
	if len(data) == 0 {
		return fmt.Errorf("write png to clipboard: no image data")
	}
	dir, err := os.MkdirTemp("", "mill-clipboard-png")
	if err != nil {
		return fmt.Errorf("write png to clipboard: %w", err)
	}
	defer func() { _ = os.RemoveAll(dir) }()

	path := filepath.Join(dir, "image.png")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("write png to clipboard: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "osascript", "-l", "JavaScript", "-e", writePNGScript)
	cmd.Env = append(os.Environ(), pngPathEnv+"="+path)
	out, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("osascript pasteboard png write failed: %w", err)
	}
	var ok bool
	if jsonErr := json.Unmarshal([]byte(strings.TrimSpace(string(out))), &ok); jsonErr != nil || !ok {
		return fmt.Errorf("the pasteboard refused the image")
	}
	return nil
}
