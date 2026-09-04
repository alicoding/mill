// Package secret holds the core-domain shape of a vault Entry (goal
// 0185): a human-facing credential record -- title, username, password,
// URL, notes -- and its own edit history. Per CLAUDE.md's core-domain
// rule the shape and its validation stay hand-written; the encrypted
// storage format (KDBX) is adopted, not this shape (see
// internal/adapters/secretvault). This is deliberately its own
// capability, not a Configure entity: see docs/goals/0185-secrets-as-
// references.md for the reasoning -- runtime access, boundary,
// protection, and history don't fit a Configure entity's field-picker
// shape.
package secret

import (
	"fmt"
	"strings"
	"time"
)

// Entry is one vault record. ID is empty for a not-yet-created entry
// (Upsert mints one); Password is populated only where the caller
// explicitly asked to reveal it (secretvault.Vault.Get/History) --
// List/Summary views never carry it, so a reveal is always a distinct,
// auditable read rather than incidental to browsing.
type Entry struct {
	ID       string
	Title    string
	Username string
	Password string
	URL      string
	Notes    string
	Tags     string
	// Kind classifies what this entry holds (goal 0306) -- what a
	// kind-filtered picker offers and what control the editor shows.
	// Empty decodes as KindText.
	Kind Kind
	// SourceRef, when set, makes this a source-backed entry: the value
	// is not held here at all but read from a configured secret source
	// at the moment of use, through the same provider grammar every
	// referencing field uses ("env:<source-id>/<KEY>",
	// internal/domain/vaultref). Password is empty for such an entry,
	// and a source's value is never copied into the vault.
	SourceRef string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Summary is an Entry with its Password/Notes omitted -- the shape the
// browse/search surface renders, so a masked list is masked by
// construction (no value to accidentally echo), not by a frontend
// convention a future call site could forget.
type Summary struct {
	ID        string
	Title     string
	Username  string
	URL       string
	Tags      string
	Kind      Kind
	SourceRef string
	UpdatedAt time.Time
}

// Validate checks an Entry is well-formed before it's persisted -- same
// "never store an unconfigured/invalid value" discipline every other
// Mill entity's own Validate already applies.
func Validate(e Entry) error {
	if strings.TrimSpace(e.Title) == "" {
		return fmt.Errorf("a vault entry needs a title")
	}
	if e.SourceRef != "" && strings.TrimSpace(e.Password) != "" {
		return fmt.Errorf("a source-backed entry holds no value of its own")
	}
	return nil
}

// ToSummary drops Password/Notes -- the one conversion every list-view
// call site shares, so "what a summary omits" has exactly one
// definition.
func (e Entry) ToSummary() Summary {
	return Summary{ID: e.ID, Title: e.Title, Username: e.Username, URL: e.URL, Tags: e.Tags, Kind: NormalizeKind(string(e.Kind)), SourceRef: e.SourceRef, UpdatedAt: e.UpdatedAt}
}
