// Package clipboardhistorysvc is the Wails-facing layer over
// internal/domain/clipboardhistory: storage/CRUD for goal 0234's
// guarded clipboard-history capture. Entries arrive already redacted
// (via composition's own apply-clipboard-history-store node, wired
// through SetClipboardHistoryAppender below) -- this service never
// redacts, it only persists, evicts, and serves the list/copy/pin/
// delete actions the Clipboard history dialog drives.
package clipboardhistorysvc

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/clipboard"
	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/clipboardhistory"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/google/uuid"
)

// clipboardHistoryKey mirrors guardrailRulesKey's shape: one JSON array
// under one settings key.
const clipboardHistoryKey = "clipboard-history"

// writeClipboardTextFn is a package-level function var (same
// testability pattern as composition/applytext.go's own
// writeClipboardText), not a direct clipboard.WriteText call.
var writeClipboardTextFn = clipboard.WriteText

// recordCopyAuditFn defaults to a no-op so a copy works before
// SetAuditRecorder is wired (or a headless `go test`) -- audit is
// observability, not a correctness gate on the copy itself, same
// posture secretsvc.recordAccess's own nil-store guard already takes.
var recordCopyAuditFn = func(entryID, label string) {}

// SetAuditRecorder wires the function that leaves one audit line per
// copy-back (goal 0234, reusing 0203 S3's audit plane via
// secretsvc.SecretService.RecordAccess). Exported for main.go wiring
// only, never a frontend RPC.
//
//wails:ignore
func SetAuditRecorder(fn func(entryID, label string)) {
	recordCopyAuditFn = fn
}

// ClipboardHistoryService holds every captured entry in memory,
// persisted as one JSON blob -- the same settings-store-backed shape
// guardrailsvc.GuardrailService already uses for a small, infrequently
// large collection (at most MaxUnpinned + however many are pinned).
type ClipboardHistoryService struct {
	mu      sync.Mutex
	store   settings.Store
	entries []clipboardhistory.Entry
}

func NewClipboardHistoryService(store settings.Store) *ClipboardHistoryService {
	s := &ClipboardHistoryService{store: store}
	s.restore()
	return s
}

func (s *ClipboardHistoryService) restore() {
	if raw, ok := s.store.Get(clipboardHistoryKey).(string); ok && raw != "" {
		var entries []clipboardhistory.Entry
		if err := json.Unmarshal([]byte(raw), &entries); err == nil {
			s.entries = entries
		}
	}
}

func (s *ClipboardHistoryService) persist() error {
	data, err := json.Marshal(s.entries)
	if err != nil {
		return fmt.Errorf("marshal clipboard history: %w", err)
	}
	if err := s.store.Set(clipboardHistoryKey, string(data)); err != nil {
		return fmt.Errorf("persist clipboard history: %w", err)
	}
	return nil
}

// Append stores one already-redacted capture, evicting the oldest
// unpinned entries past clipboardhistory.MaxUnpinned. Blank/whitespace-
// only text (e.g. a redaction that scrubbed everything) is silently
// skipped -- nothing worth keeping. Exported for composition's own
// SetClipboardHistoryAppender seam, never a frontend RPC.
//
//wails:ignore
func (s *ClipboardHistoryService) Append(text string) error {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	previous := s.entries
	entry := clipboardhistory.Entry{ID: uuid.NewString(), Text: text, CreatedAt: time.Now().UTC()}
	s.entries = clipboardhistory.Evict(append(append([]clipboardhistory.Entry(nil), s.entries...), entry))
	if err := s.persist(); err != nil {
		s.entries = previous
		return fmt.Errorf("save clipboard history entry: %w", err)
	}
	dataevent.Emit("clipboard-history", entry.ID)
	return nil
}

// ListClipboardHistory returns every entry, pinned-first then newest-
// first (clipboardhistory.SortForDisplay) -- the order the Clipboard
// history dialog renders directly.
func (s *ClipboardHistoryService) ListClipboardHistory() []clipboardhistory.Entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	return clipboardhistory.SortForDisplay(s.entries)
}

func findEntry(entries []clipboardhistory.Entry, id string) (clipboardhistory.Entry, bool) {
	for _, e := range entries {
		if e.ID == id {
			return e, true
		}
	}
	return clipboardhistory.Entry{}, false
}

// previewLabel denormalizes id's first line, capped, for the audit
// record's own Label -- same "entry's title AT READ TIME" reasoning
// secretaudit.Record.Label's own doc comment gives: a later delete
// must never rewrite history.
const previewLabelCap = 120

func previewLabel(text string) string {
	line, _, _ := strings.Cut(text, "\n")
	line = strings.TrimSpace(line)
	if len(line) > previewLabelCap {
		return line[:previewLabelCap] + "…"
	}
	return line
}

// CopyClipboardHistoryEntry writes id's text back to the real
// clipboard and records one audit line (goal 0234, reusing 0203 S3's
// audit plane). clipboard.WriteText also marks this write as Mill's
// own, so the trigger-clipboard-change poller skips re-capturing it as
// a new entry on the very next cycle.
func (s *ClipboardHistoryService) CopyClipboardHistoryEntry(id string) error {
	s.mu.Lock()
	entry, ok := findEntry(s.entries, id)
	s.mu.Unlock()
	if !ok {
		return fmt.Errorf("unknown clipboard history entry: %s", id)
	}
	if err := writeClipboardTextFn(entry.Text); err != nil {
		return fmt.Errorf("copy clipboard history entry: %w", err)
	}
	recordCopyAuditFn(entry.ID, previewLabel(entry.Text))
	return nil
}

// SetClipboardHistoryPinned pins or unpins id -- a pinned entry floats
// to the top of ListClipboardHistory and is never evicted by Append's
// retention cap, regardless of age.
func (s *ClipboardHistoryService) SetClipboardHistoryPinned(id string, pinned bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, e := range s.entries {
		if e.ID != id {
			continue
		}
		previous := s.entries[i].Pinned
		s.entries[i].Pinned = pinned
		if err := s.persist(); err != nil {
			s.entries[i].Pinned = previous
			return fmt.Errorf("save clipboard history pin: %w", err)
		}
		dataevent.Emit("clipboard-history", id)
		return nil
	}
	return fmt.Errorf("unknown clipboard history entry: %s", id)
}

// DeleteClipboardHistoryEntry permanently removes id -- no undo, same
// posture SecretService.DeleteSecret already takes for its own entries.
func (s *ClipboardHistoryService) DeleteClipboardHistoryEntry(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	idx := -1
	for i, e := range s.entries {
		if e.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		return nil
	}
	removed := s.entries[idx]
	s.entries = append(s.entries[:idx], s.entries[idx+1:]...)
	if err := s.persist(); err != nil {
		s.entries = append(s.entries, clipboardhistory.Entry{})
		copy(s.entries[idx+1:], s.entries[idx:])
		s.entries[idx] = removed
		return fmt.Errorf("save clipboard history deletion: %w", err)
	}
	dataevent.Emit("clipboard-history", id)
	return nil
}
