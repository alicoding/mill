package clipboardhistorysvc

import (
	"errors"
	"testing"

	"github.com/alicoding/mill/internal/services/servicetest"
)

func TestAppend_SkipsBlankText(t *testing.T) {
	s := NewClipboardHistoryService(servicetest.NewFakeStore())
	if err := s.Append("   \n\t "); err != nil {
		t.Fatalf("Append(blank) error: %v", err)
	}
	if got := s.ListClipboardHistory(); len(got) != 0 {
		t.Errorf("ListClipboardHistory() = %d entries after a blank Append, want 0", len(got))
	}
}

func TestAppend_ThenList_NewestFirst(t *testing.T) {
	s := NewClipboardHistoryService(servicetest.NewFakeStore())
	if err := s.Append("first"); err != nil {
		t.Fatalf("Append(first): %v", err)
	}
	if err := s.Append("second"); err != nil {
		t.Fatalf("Append(second): %v", err)
	}
	got := s.ListClipboardHistory()
	if len(got) != 2 || got[0].Text != "second" || got[1].Text != "first" {
		t.Fatalf("ListClipboardHistory() = %+v, want [second, first]", got)
	}
}

func TestAppend_PersistFailureRollsBack(t *testing.T) {
	store := servicetest.NewFakeStore()
	s := NewClipboardHistoryService(store)
	if err := s.Append("kept"); err != nil {
		t.Fatalf("Append(kept): %v", err)
	}
	store.SetErr = errors.New("disk full")
	if err := s.Append("lost"); err == nil {
		t.Fatal("Append() error = nil, want the persist failure to propagate")
	}
	got := s.ListClipboardHistory()
	if len(got) != 1 || got[0].Text != "kept" {
		t.Fatalf("ListClipboardHistory() after a failed Append = %+v, want only [kept] (rolled back)", got)
	}
}

func TestSetClipboardHistoryPinned_UnknownEntry(t *testing.T) {
	s := NewClipboardHistoryService(servicetest.NewFakeStore())
	if err := s.SetClipboardHistoryPinned("nope", true); err == nil {
		t.Error("SetClipboardHistoryPinned(unknown) error = nil, want an error")
	}
}

func TestSetClipboardHistoryPinned_FloatsToTop(t *testing.T) {
	s := NewClipboardHistoryService(servicetest.NewFakeStore())
	if err := s.Append("older"); err != nil {
		t.Fatalf("Append(older): %v", err)
	}
	if err := s.Append("newer"); err != nil {
		t.Fatalf("Append(newer): %v", err)
	}
	older := s.ListClipboardHistory()[1]
	if err := s.SetClipboardHistoryPinned(older.ID, true); err != nil {
		t.Fatalf("SetClipboardHistoryPinned: %v", err)
	}
	got := s.ListClipboardHistory()
	if got[0].Text != "older" || !got[0].Pinned {
		t.Errorf("ListClipboardHistory()[0] = %+v, want the pinned (older) entry first", got[0])
	}
}

func TestDeleteClipboardHistoryEntry_RemovesIt(t *testing.T) {
	s := NewClipboardHistoryService(servicetest.NewFakeStore())
	if err := s.Append("gone soon"); err != nil {
		t.Fatalf("Append: %v", err)
	}
	id := s.ListClipboardHistory()[0].ID
	if err := s.DeleteClipboardHistoryEntry(id); err != nil {
		t.Fatalf("DeleteClipboardHistoryEntry: %v", err)
	}
	if got := s.ListClipboardHistory(); len(got) != 0 {
		t.Errorf("ListClipboardHistory() after delete = %d entries, want 0", len(got))
	}
}

func TestDeleteClipboardHistoryEntry_UnknownIsNoop(t *testing.T) {
	s := NewClipboardHistoryService(servicetest.NewFakeStore())
	if err := s.DeleteClipboardHistoryEntry("nope"); err != nil {
		t.Errorf("DeleteClipboardHistoryEntry(unknown) error = %v, want nil (no-op)", err)
	}
}

func TestCopyClipboardHistoryEntry_UnknownEntry(t *testing.T) {
	s := NewClipboardHistoryService(servicetest.NewFakeStore())
	if err := s.CopyClipboardHistoryEntry("nope"); err == nil {
		t.Error("CopyClipboardHistoryEntry(unknown) error = nil, want an error")
	}
}

// TestCopyClipboardHistoryEntry_WritesAndAudits proves a copy both
// writes the real clipboard (via the injected seam) and leaves one
// audit line (goal 0234, reusing 0203 S3's audit plane) -- without
// touching the real macOS pasteboard, per ADR-0002's fake-injection
// pattern for adapter-backed logic under unit test.
func TestCopyClipboardHistoryEntry_WritesAndAudits(t *testing.T) {
	origWrite, origAudit := writeClipboardTextFn, recordCopyAuditFn
	t.Cleanup(func() { writeClipboardTextFn, recordCopyAuditFn = origWrite, origAudit })

	var written string
	writeClipboardTextFn = func(text string) error {
		written = text
		return nil
	}
	var auditedID, auditedLabel string
	SetAuditRecorder(func(entryID, label string) {
		auditedID, auditedLabel = entryID, label
	})

	s := NewClipboardHistoryService(servicetest.NewFakeStore())
	if err := s.Append("copy me"); err != nil {
		t.Fatalf("Append: %v", err)
	}
	entry := s.ListClipboardHistory()[0]

	if err := s.CopyClipboardHistoryEntry(entry.ID); err != nil {
		t.Fatalf("CopyClipboardHistoryEntry: %v", err)
	}
	if written != "copy me" {
		t.Errorf("clipboard write got %q, want the entry's own text", written)
	}
	if auditedID != entry.ID {
		t.Errorf("audit entryID = %q, want %q", auditedID, entry.ID)
	}
	if auditedLabel != "copy me" {
		t.Errorf("audit label = %q, want the entry's preview text", auditedLabel)
	}
}

func TestPreviewLabel_TruncatesAndTakesFirstLine(t *testing.T) {
	got := previewLabel("first line\nsecond line")
	if got != "first line" {
		t.Errorf("previewLabel() = %q, want only the first line", got)
	}

	long := ""
	for i := 0; i < previewLabelCap+20; i++ {
		long += "x"
	}
	got = previewLabel(long)
	if len([]rune(got)) != previewLabelCap+1 { // +1 for the ellipsis rune
		t.Errorf("previewLabel(long) length = %d, want %d (cap + ellipsis)", len([]rune(got)), previewLabelCap+1)
	}
}
