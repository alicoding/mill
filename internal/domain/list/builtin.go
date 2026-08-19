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

// ExampleTaskTrackerID is the seeded example List goal 0070's
// apply-list-row write-path example targets -- exported for the same
// reason ExampleCountryCodesID is (composition's seeded workflow
// references it without a string literal that could drift).
const ExampleTaskTrackerID = "example-task-tracker-list"

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
	taskRow := func(id, task, status string) Row {
		return Row{
			ID:        id,
			Values:    map[string]string{"task": task, "status": status},
			CreatedAt: now,
			UpdatedAt: now,
			Status:    RowActive,
		}
	}

	return []List{
		{
			ID:    ExampleCountryCodesID,
			Label: "Example: Country codes",
			Description: "A typed lookup dataset (code -> country name) -- the seeded proof for " +
				"both list-lookup (legacy, via the derived key/value view over its first two columns) and " +
				"list-search (typed exact/fuzzy matching). Includes one deliberately Expired row (a defunct " +
				"code) demonstrating the exclude-by-default rule live.",
			Columns: []typedfield.Field{
				{Key: "code", Label: "Code", Type: typedfield.TypeText, Required: true},
				{Key: "name", Label: "Name", Type: typedfield.TypeText, Required: true},
				// legacyRegion is the seeded proof for docs/adr/0040
				// decision 2: a Deprecated column, still valid on every
				// row's own data, de-emphasized in this List's own edit
				// form and excluded from a list-search node's new
				// match-parameter picker.
				{Key: "legacyRegion", Label: "Region (legacy)", Type: typedfield.TypeText, Deprecated: true},
			},
			Rows: []Row{
				activeRow("row-us", "US", "United States"),
				activeRow("row-ca", "CA", "Canada"),
				activeRow("row-mx", "MX", "Mexico"),
				activeRow("row-fr", "FR", "France"),
				expiredRow("row-su", "SU", "Soviet Union"),
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(4),
		},
		{
			ID:    ExampleTaskTrackerID,
			Label: "Example: Task tracker",
			Description: "A tracker a workflow updates on every run: \"Example: Track in a list\" adds a row " +
				"here by its \"task\" value, then updates that same row's status instead of duplicating it. " +
				"Published at v1, so a step pinned to that version keeps seeing this list's original row even " +
				"after later runs add more.",
			Columns: []typedfield.Field{
				{Key: "task", Label: "Task", Type: typedfield.TypeText, Required: true},
				// Options order is the color order (projection pills,
				// goal 0105 part 3): Done=success, Blocked=danger,
				// In progress=attention.
				{Key: "status", Label: "Status", Type: typedfield.TypeOptions, Options: []string{"Done", "Blocked", "In progress"}},
			},
			Rows: []Row{
				taskRow("row-tracker-setup", "Set up Mill", "Done"),
			},
			BuiltIn: true,
			// SeedRevision 2: the status column became a typed Options
			// column so the seeded projection demonstrates status pills.
			Seed: seedorigin.Stamp(2),
			PublishedVersion: 1,
			Versions: []ListVersion{
				{
					Version: 1,
					SavedAt: now,
					Columns: []typedfield.Field{
						{Key: "task", Label: "Task", Type: typedfield.TypeText, Required: true},
						{Key: "status", Label: "Status", Type: typedfield.TypeText},
					},
					Rows: []Row{taskRow("row-tracker-setup", "Set up Mill", "Done")},
				},
			},
		},
	}
}
