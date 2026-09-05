package clipboard

import (
	"testing"
	"time"
)

func TestMemory_WriteTextReadTextRoundTrip(t *testing.T) {
	m := NewMemory()
	if err := m.WriteText("hello memory"); err != nil {
		t.Fatalf("WriteText() error: %v", err)
	}
	got, err := m.ReadText()
	if err != nil {
		t.Fatalf("ReadText() error: %v", err)
	}
	if got != "hello memory" {
		t.Errorf("ReadText() = %q, want %q", got, "hello memory")
	}
}

func TestMemory_ReadTextEmptyByDefault(t *testing.T) {
	m := NewMemory()
	got, err := m.ReadText()
	if err != nil {
		t.Fatalf("ReadText() on a fresh Memory: error %v, want nil (mirrors pbpaste on an empty pasteboard)", err)
	}
	if got != "" {
		t.Errorf("ReadText() on a fresh Memory = %q, want empty", got)
	}
}

func TestMemory_WriteHTMLReadHTMLRoundTrip(t *testing.T) {
	m := NewMemory()
	const html = "<p>hello</p>"
	if err := m.WriteHTML(html); err != nil {
		t.Fatalf("WriteHTML() error: %v", err)
	}
	got, err := m.ReadHTML()
	if err != nil {
		t.Fatalf("ReadHTML() error: %v", err)
	}
	if got != html {
		t.Errorf("ReadHTML() = %q, want %q", got, html)
	}
}

func TestMemory_ReadHTMLErrorsWhenAbsent(t *testing.T) {
	m := NewMemory()
	if _, err := m.ReadHTML(); err == nil {
		t.Fatal("ReadHTML() on a fresh Memory: want an error, mirroring Host.ReadHTML with no HTML flavor")
	}
}

func TestMemory_WriteTextReplacesEarlierHTML(t *testing.T) {
	m := NewMemory()
	if err := m.WriteHTML("<p>doomed</p>"); err != nil {
		t.Fatalf("WriteHTML() error: %v", err)
	}
	if err := m.WriteText("plain wins"); err != nil {
		t.Fatalf("WriteText() error: %v", err)
	}
	if _, err := m.ReadHTML(); err == nil {
		t.Error("ReadHTML() after a later WriteText(): want an error -- each write REPLACES every flavor, mirroring pbcopy/AppleScript's own single-flavor-replace behavior")
	}
}

func TestMemory_WritePNGReadsBackViaTypes(t *testing.T) {
	m := NewMemory()
	if err := m.WritePNG([]byte{0x89, 'P', 'N', 'G'}); err != nil {
		t.Fatalf("WritePNG() error: %v", err)
	}
	types, err := m.Types()
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
		t.Errorf("Types() = %v, want it to contain %q after WritePNG()", types, pngPasteboardType)
	}
}

func TestMemory_WritePNGRejectsEmptyData(t *testing.T) {
	m := NewMemory()
	if err := m.WritePNG(nil); err == nil {
		t.Fatal("WritePNG(nil) = nil, want an error rather than a silently empty clipboard")
	}
}

func TestMemory_IsConcealedAlwaysFalse(t *testing.T) {
	m := NewMemory()
	if err := m.WriteText("anything"); err != nil {
		t.Fatalf("WriteText() error: %v", err)
	}
	concealed, err := m.IsConcealed()
	if err != nil {
		t.Fatalf("IsConcealed() error: %v", err)
	}
	if concealed {
		t.Error("IsConcealed() = true, want false -- Memory's own API can never set a concealed-type marker")
	}
}

func TestMemory_ConsumeSelfWriteMatchesItsOwnWrite(t *testing.T) {
	m := NewMemory()
	if err := m.WriteText("self write"); err != nil {
		t.Fatalf("WriteText() error: %v", err)
	}
	if !m.ConsumeSelfWrite("self write") {
		t.Error("ConsumeSelfWrite() = false immediately after WriteText() wrote the same text, want true")
	}
}

func TestMemory_ReadFileURLsAlwaysEmpty(t *testing.T) {
	m := NewMemory()
	paths, err := m.ReadFileURLs()
	if err != nil {
		t.Fatalf("ReadFileURLs() error: %v", err)
	}
	if len(paths) != 0 {
		t.Errorf("ReadFileURLs() = %v, want empty -- Memory has no Finder integration", paths)
	}
}

func TestMemory_WatchChangesFiresOnChange(t *testing.T) {
	m := NewMemory()
	if err := m.WriteText("baseline"); err != nil {
		t.Fatalf("WriteText(baseline) error: %v", err)
	}

	fired := make(chan string, 1)
	stop := m.WatchChanges(5*time.Millisecond, func(text string) {
		select {
		case fired <- text:
		default:
		}
	})
	defer stop()

	time.Sleep(20 * time.Millisecond) // let the watch loop read the baseline first
	if err := m.WriteText("changed"); err != nil {
		t.Fatalf("WriteText(changed) error: %v", err)
	}

	select {
	case got := <-fired:
		if got != "changed" {
			t.Errorf("WatchChanges fired with %q, want %q", got, "changed")
		}
	case <-time.After(1 * time.Second):
		t.Fatal("WatchChanges never fired after the in-memory clipboard changed")
	}
}

func TestNew_DefaultsToMemoryInsideATestBinary(t *testing.T) {
	// No MILL_CLIPBOARD set: New() must resolve to Memory (never
	// construct Host, which would panic without MILL_CLIPBOARD_HOST_OK)
	// since testing.Testing() is true for the whole lifetime of this
	// test binary -- the exact goal 0356 regression: a package-level
	// var initialized as clipboard.New().WriteText must never reach the
	// real pasteboard from a `go test` run.
	if _, ok := New().(*Memory); !ok {
		t.Fatalf("New() with MILL_CLIPBOARD unset inside a test binary = %T, want *Memory", New())
	}
}

func TestForTests_ReturnsTheSameSingletonEveryCall(t *testing.T) {
	if ForTests() != ForTests() {
		t.Error("ForTests() returned a different instance on a second call, want the same process-wide singleton")
	}
}
