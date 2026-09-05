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
	// Tags are the reader's own words for finding this entry again.
	Tags []string
	// Origin records where this entry came from when it was not typed
	// by hand: "import:<file name>" for one read out of an export or a
	// dotenv file. It is provenance only -- it never affects how the
	// value resolves, which is what keeps it distinct from SourceRef.
	Origin string
	// Fields are the entry's own custom fields (goal 0306 S4) -- what
	// makes the entry the record rather than five fixed columns. A
	// protected field's value is hidden until asked for, exactly as the
	// password is.
	Fields []Field
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
	ID       string
	Title    string
	Username string
	URL      string
	Tags     []string
	// FieldNames carries the entry's custom field NAMES and no values,
	// so the browse surface can match a search against them without a
	// reveal.
	FieldNames []string
	Kind       Kind
	SourceRef  string
	UpdatedAt  time.Time
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
	return validateFields(e.Fields)
}

// validateFields refuses a field that has no name, takes one of the
// entry's own column names, or repeats another field -- each would
// silently overwrite something on the way to storage.
func validateFields(fields []Field) error {
	seen := map[string]bool{}
	for _, f := range fields {
		name := strings.TrimSpace(f.Name)
		if name == "" {
			return fmt.Errorf("a field needs a name")
		}
		if IsReservedField(name) {
			return fmt.Errorf("%q is already one of this entry's own fields", name)
		}
		if seen[strings.ToLower(name)] {
			return fmt.Errorf("the field %q is listed twice", name)
		}
		seen[strings.ToLower(name)] = true
	}
	return nil
}

// ToSummary drops Password/Notes -- the one conversion every list-view
// call site shares, so "what a summary omits" has exactly one
// definition.
func (e Entry) ToSummary() Summary {
	return Summary{ID: e.ID, Title: e.Title, Username: e.Username, URL: e.URL, Tags: NormalizeTags(e.Tags), FieldNames: FieldNames(e.Fields), Kind: NormalizeKind(string(e.Kind)), SourceRef: e.SourceRef, UpdatedAt: e.UpdatedAt}
}
