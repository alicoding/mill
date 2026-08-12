package list

import (
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// ExampleCountryCodesID is the seeded example List's ID -- exported so
// composition.BuiltInWorkflows' own list-lookup/list-search seeds
// (nodetypes.go, builtinworkflows.go) can reference it without a
// string literal that could drift, same pattern
// httprequest.ExampleNoneID/decision.ExampleApproveID already
// establish.
const ExampleCountryCodesID = "example-country-codes-list"

// BuiltIn returns the seeded example List -- pure config, no
// persistence (mirrors httprequest.BuiltIn/decision.BuiltIn's shape:
// this package stays free of the settings-store concern, per
// CLAUDE.md's backend rule -- ConfigureService owns seeding/top-up).
//
// Grown from a plain key/value map (docs/goals/0010) to a typed
// "code"/"name" dataset by goal 0011 -- the seed proof for BOTH
// list-lookup (via DeriveEntries' first-two-columns reading, so the
// existing "Example: Country code lookup" workflow keeps working
// completely unchanged) and list-search (typed exact/fuzzy matching
// against real columns). Includes a deliberately Expired row (a
// defunct country code) so the seed itself demonstrates goal 0011's
// "Expired excluded from matching by default" rule live, not just in
// a unit test -- and a real near-miss ("France" vs a typo'd query) so
// fuzzy matching has something genuine to match against.
func BuiltIn() []List {
	now := time.Now()
	activeRow := func(id, code, name string) Row {
		return Row{
			ID:        id,
			Values:    map[string]string{"code": code, "name": name},
			CreatedAt: now,
			UpdatedAt: now,
			Status:    RowActive,
		}
	}
	expiredRow := func(id, code, name string) Row {
		r := activeRow(id, code, name)
		r.Status = RowExpired
		return r
	}

	return []List{
		{
			ID:    ExampleCountryCodesID,
			Label: "Example: Country codes",
			Description: "A typed lookup dataset (code -> country name) -- goal 0011's seeded proof for " +
				"both list-lookup (legacy, via the derived key/value view over its first two columns) and " +
				"list-search (typed exact/fuzzy matching). Includes one deliberately Expired row (a defunct " +
				"code) demonstrating the exclude-by-default rule live.",
			Columns: []typedfield.Field{
				{Key: "code", Label: "Code", Type: typedfield.TypeText, Required: true},
				{Key: "name", Label: "Name", Type: typedfield.TypeText, Required: true},
			},
			Rows: []Row{
				activeRow("row-us", "US", "United States"),
				activeRow("row-ca", "CA", "Canada"),
				activeRow("row-mx", "MX", "Mexico"),
				activeRow("row-fr", "FR", "France"),
				expiredRow("row-su", "SU", "Soviet Union"),
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(1),
		},
	}
}
