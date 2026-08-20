// Package list holds the core-domain shape of a List (docs/SPEC.md
// §3.2.2/§3.5, docs/goals/0011-lists-maturation.md): a reusable
// (1:many), Configure-authored typed tabular dataset a workflow's
// list-search (or the legacy list-lookup) node reads from at run
// time. Per CLAUDE.md's core-domain rule, the shape and its
// validation stay hand-written -- no library has an opinion on
// Mill's own List model.
//
// Grown from a flat key/value map (Entries) to typed Columns + Row
// records by goal 0011, against ADR-0029's canonical typedfield.Field
// vocabulary (Columns reuse it directly -- never a fifth schema
// system) and a reference-platform review recorded in SPEC.md §3.2.2:
// typed columns, system-managed audit fields (CreatedAt/UpdatedAt/
// Status) kept as platform-owned struct fields rather than
// user-declarable TypedField columns (the BuiltIn/Versions
// precedent), and Active/Expired row lifecycle with Expired excluded
// from matching by default (industry research recorded in the goal
// file: the soft-delete convention, OFAC sanctions screening, and
// Informatica MDM all exclude by default with a per-step opt-in --
// uniform across exact and fuzzy matching, never split by match
// type).
//
// Actor identity (who created/updated a row) is deliberately NOT
// modeled: Mill is single-user forever (SPEC.md §3.7's own researched-
// and-declined multi-tenancy seam) -- a fixed "local" CreatedBy/
// UpdatedBy constant would be config/schema surface for a decision
// with no real consumer today, the same premature-abstraction trap
// SPEC.md §3.5's Configure recheck already names for other fields.
// This is the goal file's own open call ("note which"), noted here.
package list

import (
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// RowStatus is a Row's platform-owned lifecycle state -- never a
// TypedField/user-declared column (goal 0011's audit-column
// decision: system-managed fields are Go struct fields, not entries
// in List.Columns).
type RowStatus string

const (
	RowActive  RowStatus = "active"
	RowExpired RowStatus = "expired"
)

// Row is one typed record in a List. Values maps a declared Column's
// Key to its string value -- the same "every value stays a plain
// string on the wire" discipline typedfield.Field itself documents;
// a Column's Type only governs validation/rendering/matching, never
// the wire shape. CreatedAt/UpdatedAt/Status are platform-owned audit
// fields, set by the owning service (internal/services/configuresvc),
// never a user-declared Column.
type Row struct {
	ID        string
	Values    map[string]string
	CreatedAt time.Time
	UpdatedAt time.Time
	Status    RowStatus
}

// List is one reusable, named typed dataset. Columns declares its
// schema (typedfield.Field, ADR-0029); Rows carries its data.
//
// Entries is the PRE-0011 flat key/value shape, kept on the struct
// for wire/backward compatibility only -- MigrateLegacyEntries
// (migrate.go) converts any list still carrying it (Columns empty,
// Entries non-empty) into the typed Columns+Rows shape the first time
// it's loaded (internal/services/configuresvc's restore()), so
// list-search/list-lookup execution logic only ever deals with
// Columns+Rows, never a third code path for the legacy shape. A list
// persisted before this goal, loaded once, re-persists in the typed
// shape; Entries is never populated by any code path after that first
// load -- new lists never populate it at all. DeriveEntries below is
// the read-side mirror: list-lookup's own execution keeps reading a
// flat map, computed from any 2+-column typed list's first two
// columns, so it never needed to change at all.
type List struct {
	ID          string
	Label       string
	Description string
	Columns     []typedfield.Field
	Rows        []Row
	Entries     map[string]string
	// BuiltIn marks a seeded example list -- purely informational,
	// same as httprequest.HTTPRequest.BuiltIn/decision.Decision.BuiltIn:
	// drives a "built-in" badge only, never gates Edit/Delete. A seeded
	// example is an ordinary, fully-editable list from the moment it
	// exists (docs/SPEC.md §2.2's Update note).
	BuiltIn bool
	// CreatedAt/UpdatedAt are system-managed audit timestamps (SPEC.md
	// §3.2.2's reserved-column pattern), stamped server-side at every
	// persisted mutation (ConfigureService), never trusted from the
	// wire. Zero value means pre-timestamp data -- migration-free.
	CreatedAt time.Time
	UpdatedAt time.Time
	// Seed is this list's seed provenance (docs/goals/0037) -- zero
	// value means "not of seed origin," migration-free. See
	// composition.Workflow.Seed's doc comment for the full reasoning.
	Seed seedorigin.Origin
	// FieldTombstones records every Columns Key this List has ever
	// deleted (docs/adr/0040 decision 3) -- see decision.Decision's own
	// FieldTombstones doc comment for the full reasoning, applied here
	// to Columns instead of Outputs.
	FieldTombstones []typedfield.FieldTombstone
	// Versions/PublishedVersion give List the same draft/publish
	// lifecycle Decision already has (docs/adr/0040 decision 4,
	// extended to a second entity by goal 0070's demonstrated need --
	// audit-replay against a List a workflow has since edited): Columns/
	// Rows above are this List's own DRAFT, edited in place exactly as
	// before this existed; Versions holds immutable snapshots frozen by
	// Publish (versioning.go), and PublishedVersion (0 = never
	// published) names which snapshot list-lookup/list-search's
	// unpinned "live@N" audit stamp reads. Both zero-valued for every
	// List persisted before this existed, migration-free.
	Versions         []ListVersion
	PublishedVersion int
}

// Validate checks a List is well-formed before it's persisted -- same
// "never store an unconfigured/invalid value" discipline every other
// domain package's own Validate already applies.
func Validate(l List) error {
	if strings.TrimSpace(l.Label) == "" {
		return fmt.Errorf("a list needs a label")
	}
	seen := make(map[string]bool, len(l.Columns))
	for _, c := range l.Columns {
		if err := typedfield.Validate(c); err != nil {
			return fmt.Errorf("column: %w", err)
		}
		if seen[c.Key] {
			return fmt.Errorf("duplicate column key %q", c.Key)
		}
		seen[c.Key] = true
	}
	for _, r := range l.Rows {
		if strings.TrimSpace(r.ID) == "" {
			return fmt.Errorf("a row needs a non-empty id")
		}
	}
	return nil
}

// DeriveEntries computes a legacy flat key/value view over a typed
// List's first two Columns (Columns[0] as key, Columns[1] as value)
// -- how list-lookup (internal/domain/composition/listlookup.go)
// keeps working completely unchanged against a typed list, whether
// it's a migrated legacy list (whose synthesized Columns are
// literally "key"/"value") or a genuinely typed one (e.g. the seeded
// "code"/"name" country-codes list): list-lookup only ever needed a
// flat map, and any 2+-column list has an unambiguous "first two
// columns" reading, so no per-list configuration is needed to keep it
// working. Expired rows are excluded (goal 0011's uniform default);
// list-lookup's own config has no field to opt back in, so this
// derived view is Active-only, full stop.
//
// Returns nil for a list with fewer than 2 columns -- nothing to
// derive a key/value pair from (a real gap for list-lookup against
// e.g. a single-column list, but list-lookup already errored on an
// empty Entries map before this goal too, so nothing regresses).
func DeriveEntries(l List) map[string]string {
	if len(l.Columns) < 2 {
		return nil
	}
	keyCol, valCol := l.Columns[0].Key, l.Columns[1].Key
	out := make(map[string]string, len(l.Rows))
	for _, r := range l.Rows {
		if r.Status == RowExpired {
			continue
		}
		out[r.Values[keyCol]] = r.Values[valCol]
	}
	return out
}

// ValidateFieldEvolutionWithRows applies the schema-evolution guard
// with the rows in view: a column no row holds a value for MAY change
// its type (the invariant is "type never changes under data", not
// "type never changes after creation" -- a grid-authored column
// commits as text before its author picks a type, and freezing it
// there would make type selection impossible; ADR-0040 amendment).
// Data-bearing columns keep the full immutability rule.
func ValidateFieldEvolutionWithRows(oldFields, newFields []typedfield.Field, tombstones []typedfield.FieldTombstone, rows []Row) error {
	newByKey := make(map[string]typedfield.Type, len(newFields))
	for _, f := range newFields {
		newByKey[f.Key] = f.Type
	}
	effectiveOld := make([]typedfield.Field, len(oldFields))
	copy(effectiveOld, oldFields)
	for i, old := range effectiveOld {
		next, present := newByKey[old.Key]
		if !present || next == old.Type {
			continue
		}
		if columnHasData(rows, old.Key) {
			continue
		}
		effectiveOld[i].Type = next
	}
	return typedfield.ValidateFieldEvolution(effectiveOld, newFields, tombstones)
}

func columnHasData(rows []Row, key string) bool {
	for _, r := range rows {
		if r.Values[key] != "" {
			return true
		}
	}
	return false
}
