package clipboard

import (
	"fmt"
	"sync"
	"time"
)

// Memory is an in-memory stand-in for the real pasteboard: every method
// the same shape as Host's, storing state in this process instead of
// reaching the OS. New's default Port for a `go test` binary and for
// any e2e server spawned with MILL_CLIPBOARD=memory (goal 0356) — a
// test or a headless e2e run must never land on the machine's real
// clipboard.
//
// Each WriteText/WriteHTML/WritePNG call REPLACES every flavor, not
// just its own: it mirrors Host's own single-flavor-replace behavior
// (pbcopy and AppleScript's "set the clipboard to X" both clear the
// whole pasteboard before setting the one flavor they write), so a
// capture-clipboard-html node's own HTML-then-text fallback (capture.go)
// behaves identically against either Port.
type Memory struct {
	mu       sync.Mutex
	text     string
	html     *string
	png      []byte
	fileURLs []string
	selfWriteTracker
}

// NewMemory returns an empty in-memory clipboard.
func NewMemory() *Memory {
	return &Memory{}
}

func (m *Memory) reset(locked func()) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.text, m.html, m.png = "", nil, nil
	locked()
}

// ReadText returns whatever text was last written -- "" (no error) when
// nothing has, mirroring pbpaste's own success-with-empty-output
// behavior on an empty or non-text pasteboard.
func (m *Memory) ReadText() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.text, nil
}

// WriteText replaces the clipboard's whole content with text.
func (m *Memory) WriteText(text string) error {
	m.reset(func() { m.text = text })
	m.markSelfWrite(text)
	return nil
}

// ReadHTML returns the last-written HTML, or an error when none is set
// -- mirroring Host.ReadHTML's own "no HTML on clipboard" failure when
// the HTML flavor is absent.
func (m *Memory) ReadHTML() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.html == nil {
		return "", fmt.Errorf("no HTML on clipboard")
	}
	return *m.html, nil
}

// WriteHTML replaces the clipboard's whole content with html.
func (m *Memory) WriteHTML(html string) error {
	m.reset(func() { m.html = &html })
	return nil
}

// WritePNG replaces the clipboard's whole content with data. data must
// be non-empty, same contract as Host.WritePNG.
func (m *Memory) WritePNG(data []byte) error {
	if len(data) == 0 {
		return fmt.Errorf("write png to clipboard: no image data")
	}
	m.reset(func() { m.png = data })
	return nil
}

// Info synthesizes a report in the same shape as macOS's own "clipboard
// info" (Host.Info): a comma-separated «class XXXX», byte-size list, so
// any caller parsing it (composition's formatClipboardInfo) behaves the
// same against either Port.
func (m *Memory) Info() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var parts []string
	if m.text != "" {
		parts = append(parts, fmt.Sprintf("«class utf8», %d", len(m.text)))
	}
	if m.html != nil {
		parts = append(parts, fmt.Sprintf("«class HTML», %d", len(*m.html)))
	}
	if len(m.png) > 0 {
		parts = append(parts, fmt.Sprintf("«class PNGf», %d", len(m.png)))
	}
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += ", "
		}
		out += p
	}
	return out, nil
}

// Types reports every flavor currently set, by UTI -- Host.Types'
// in-memory equivalent, the input IsConcealed checks.
func (m *Memory) Types() ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var types []string
	if m.text != "" {
		types = append(types, "public.utf8-plain-text")
	}
	if m.html != nil {
		types = append(types, "public.html")
	}
	if len(m.png) > 0 {
		types = append(types, pngPasteboardType)
	}
	return types, nil
}

// ReadFileURLs always returns an empty list: Memory has no Finder/OS
// integration to ever populate it, matching "no file ever copied" --
// the honest default for a Port that never had a WriteFileURLs door.
func (m *Memory) ReadFileURLs() ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.fileURLs, nil
}

// IsConcealed is always false: nothing in Memory's own API can ever set
// one of concealedTypes' markers.
func (m *Memory) IsConcealed() (bool, error) {
	types, err := m.Types()
	if err != nil {
		return false, err
	}
	return isConcealedIn(types), nil
}

// WatchChanges polls Memory's own stored text; see watchChanges' own
// doc comment for the shared poll/dedup logic.
func (m *Memory) WatchChanges(interval time.Duration, fn func(text string)) (stop func()) {
	return watchChanges(interval, fn, m.ReadText)
}
