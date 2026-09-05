package clipboard

import (
	"bytes"
	"encoding/base64"
	"testing"

	"github.com/alicoding/mill/internal/adapters/clipboard/clipboardtest"
)

// twoByTwoPNG is a valid 2x2 PNG, base64-encoded -- the smallest real
// image the pasteboard will accept, so the round-trip below proves the
// PNG FLAVOR was registered rather than that some bytes were stored.
const twoByTwoPNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAACZgbYnAAAAF0lEQVQIW2P8z8DwnwEJMDIwMDCgCwIAeqcEBAvIYHMAAAAASUVORK5CYII="

func TestWritePNG_RegistersThePNGFlavor(t *testing.T) {
	skipUnlessRealDesktop(t)
	h := newRealHost(t)
	if testing.Short() {
		t.Skip("skipping the real-pasteboard PNG write under -short")
	}

	data, err := base64.StdEncoding.DecodeString(twoByTwoPNG)
	if err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	if !bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")) {
		t.Fatal("the fixture is not a PNG")
	}

	clipboardtest.WithRealClipboardLock(func() {
		if err := h.WritePNG(data); err != nil {
			t.Fatalf("WritePNG() error: %v", err)
		}
		types, err := h.Types()
		if err != nil {
			t.Fatalf("Types() error: %v", err)
		}
		found := false
		for _, ty := range types {
			if ty == pngPasteboardType {
				found = true
			}
		}
		if !found {
			t.Errorf("Types() = %v, want it to contain %q", types, pngPasteboardType)
		}
	})
}

func TestWritePNG_RejectsEmptyData(t *testing.T) {
	h := newRealHost(t)
	if err := h.WritePNG(nil); err == nil {
		t.Fatal("WritePNG(nil) = nil, want an error rather than a silently empty clipboard")
	}
}
