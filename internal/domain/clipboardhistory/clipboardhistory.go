// Package clipboardhistory holds the pure types and retention/display
// logic for goal 0234's guarded clipboard-history capture: what an
// entry is, when the oldest unpinned ones get evicted, and what order
// the list surface renders them in. Storage (persistence, CRUD, the
// clipboard/audit side effects) lives one layer up in
// internal/services/clipboardhistorysvc (.claude/rules/backend.md).
package clipboardhistory

import (
	"sort"
	"time"
)

// MaxUnpinned bounds how many unpinned entries are kept -- the
// converged retention default across clipboard-history apps (Maccy,
// Raycast; goal 0234's own research). Pinned entries are never evicted
// by this cap, regardless of age.
const MaxUnpinned = 200

// Entry is one captured clipboard text, already redacted (known secret
// values and secret-shaped patterns scrubbed) and already screened
// (never a confidential-marked or Mill-self-written value) by the time
// it reaches this package -- see the apply-clipboard-history-store
// node's own doc comment for where those checks happen.
type Entry struct {
	ID        string
	Text      string
	CreatedAt time.Time
	Pinned    bool
}

// Evict drops the oldest unpinned entries once their count exceeds
// MaxUnpinned, leaving every pinned entry untouched regardless of age.
// Caller order is not assumed; kept entries retain their original
// relative order.
func Evict(entries []Entry) []Entry {
	unpinnedCount := 0
	for _, e := range entries {
		if !e.Pinned {
			unpinnedCount++
		}
	}
	overflow := unpinnedCount - MaxUnpinned
	if overflow <= 0 {
		return entries
	}

	type ageIndex struct {
		idx int
		at  time.Time
	}
	unpinned := make([]ageIndex, 0, unpinnedCount)
	for i, e := range entries {
		if !e.Pinned {
			unpinned = append(unpinned, ageIndex{i, e.CreatedAt})
		}
	}
	sort.Slice(unpinned, func(a, b int) bool { return unpinned[a].at.Before(unpinned[b].at) })

	drop := make(map[int]bool, overflow)
	for i := 0; i < overflow; i++ {
		drop[unpinned[i].idx] = true
	}

	out := make([]Entry, 0, len(entries)-overflow)
	for i, e := range entries {
		if !drop[i] {
			out = append(out, e)
		}
	}
	return out
}

// SortForDisplay orders entries pinned-first (each group newest-first)
// -- pins float to the top of the Clipboard history list while the
// rest reads newest-first, goal 0234's design contract.
func SortForDisplay(entries []Entry) []Entry {
	out := make([]Entry, len(entries))
	copy(out, entries)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Pinned != out[j].Pinned {
			return out[i].Pinned
		}
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out
}
