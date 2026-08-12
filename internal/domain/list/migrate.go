package list

import (
	"sort"
	"time"

	"github.com/alicoding/mill/internal/domain/typedfield"
)

// MigrateLegacyEntries converts a pre-0011 flat key/value List
// (Entries populated, Columns/Rows empty) into the typed Columns+Rows
// shape -- goal 0011's decided backward-compat approach ("a migration
// (single key/value columns)"). Synthesizes two text Columns, "key"
// and "value", and one Row per entry, sorted by key for a
// deterministic, reviewable result (Go map iteration order is
// otherwise random, which would make a migrated list's row order
// change on every restart for no reason). Every migrated row starts
// Active with CreatedAt/UpdatedAt stamped at migration time -- the
// legacy Entries map carries no real creation timestamp to preserve,
// and Mill has no actor identity to attribute rows to (see list.go's
// own doc comment on CreatedBy/UpdatedBy).
//
// newRowID is injected rather than generated here: row-ID minting
// stays a service-layer concern (internal/services/configuresvc,
// which already mints List IDs themselves via seeding.NewSlugID) --
// this package stays pure per .claude/rules/backend.md's domain-
// purity rule, with no ID-generation policy of its own.
//
// Called once per list, either from ConfigureService's restore() (a
// real machine's already-persisted data) or ImportList (an old
// exported-list JSON document still carrying the legacy shape).
func MigrateLegacyEntries(entries map[string]string, newRowID func() string) ([]typedfield.Field, []Row) {
	if len(entries) == 0 {
		return nil, nil
	}
	columns := []typedfield.Field{
		{Key: "key", Label: "Key", Type: typedfield.TypeText},
		{Key: "value", Label: "Value", Type: typedfield.TypeText},
	}
	keys := make([]string, 0, len(entries))
	for k := range entries {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	now := time.Now()
	rows := make([]Row, 0, len(keys))
	for _, k := range keys {
		rows = append(rows, Row{
			ID:        newRowID(),
			Values:    map[string]string{"key": k, "value": entries[k]},
			CreatedAt: now,
			UpdatedAt: now,
			Status:    RowActive,
		})
	}
	return columns, rows
}
