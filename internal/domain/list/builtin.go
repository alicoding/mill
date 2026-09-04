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

// ExampleJiraIssuesID is the seeded synced-List example (docs/goals/
// 0299): the target of the seeded "Example: Jira issues → List"
// workflow, exported for the same reason the two above are.
const ExampleJiraIssuesID = "example-jira-issues-list"

// ExampleBrunoResultsID is the seeded List the Bruno run workflow
// (goal 0308) mirrors a collection run's report into, one row per
// request matched by its path.
const ExampleBrunoResultsID = "example-bruno-results-list"

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
			ID:    ExampleJiraIssuesID,
			Label: "Example: Jira issues",
			Description: "A one-way mirror of a Jira search: \"Example: Jira issues → List\" refreshes these " +
				"rows on a schedule once its Jira integration is configured, matching each issue by key. " +
				"Mill never writes back to Jira. An issue's own door is its link in the url column, and " +
				"the next sync overwrites what you change here.",
			Columns: []typedfield.Field{
				{Key: "key", Label: "Key", Type: typedfield.TypeText, Required: true},
				{Key: "summary", Label: "Summary", Type: typedfield.TypeText},
				// Jira's default workflow statuses; the sync writes whatever
				// the source says, so an unlisted status still lands as text.
				{Key: "status", Label: "Status", Type: typedfield.TypeText},
				{Key: "assignee", Label: "Assignee", Type: typedfield.TypeText},
				{Key: "updated", Label: "Updated", Type: typedfield.TypeText},
				{Key: "url", Label: "Link", Type: typedfield.TypeText},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(2),
		},
		{
			ID:    ExampleCountryCodesID,
			Label: "Example: Country codes",
			Description: "A typed lookup dataset (code -> country name). Includes one deliberately " +
				"Expired row (a defunct code) demonstrating the exclude-by-default rule live.",
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
			Seed:    seedorigin.Stamp(5),
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
				// The converged task record (docs/goals/0300): what every
				// task app agrees a task carries beyond a title and a
				// status. The Quick Panel's "Save as task" fills task,
				// status, scheduled and done.
				{Key: "description", Label: "Description", Type: typedfield.TypeText, Multiline: true},
				{Key: "due", Label: "Due", Type: typedfield.TypeDate},
				{Key: "scheduled", Label: "Scheduled", Type: typedfield.TypeDate},
				{Key: "start", Label: "Start", Type: typedfield.TypeDate},
				{Key: "priority", Label: "Priority", Type: typedfield.TypeOptions, Options: []string{"Low", "Medium", "High"}},
				{Key: "recurrence", Label: "Repeats", Type: typedfield.TypeText},
				{Key: "done", Label: "Done", Type: typedfield.TypeBoolean},
				{Key: "tags", Label: "Tags", Type: typedfield.TypeText},
			},
			Rows: []Row{
				taskRow("row-tracker-setup", "Set up Mill", "Done"),
			},
			BuiltIn: true,
			// SeedRevision 3: the converged task fields joined the schema
			// (goal 0300); revision 2 made status a typed Options column.
			Seed:             seedorigin.Stamp(3),
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
		{
			ID:    ExampleBrunoResultsID,
			Label: "Example: Bruno results",
			Description: "The last run of a Bruno collection, one row per request: \"Example: Run a Bruno collection\" " +
				"runs the bru CLI and mirrors its JSON report here, matched by request path. Bruno stays the " +
				"tool for authoring and running requests; this List is where the outcome lands.",
			Columns: []typedfield.Field{
				{Key: "path", Label: "Request", Type: typedfield.TypeText, Required: true},
				{Key: "name", Label: "Name", Type: typedfield.TypeText},
				{Key: "method", Label: "Method", Type: typedfield.TypeText},
				{Key: "status", Label: "Result", Type: typedfield.TypeText},
				{Key: "httpStatus", Label: "HTTP status", Type: typedfield.TypeText},
				{Key: "durationMs", Label: "Duration (ms)", Type: typedfield.TypeText},
				{Key: "error", Label: "Error", Type: typedfield.TypeText},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(1),
		},
	}
}
