package configuresvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/reference"
)

// TestListUsageSummary_ReportsCountsPerList is Configure's Lists page's
// own data source (docs/goals/0392 Decision 3's "Used on N boards, M
// workflows" line and Unused filter): one call answering every list's
// usage, rather than one RPC per row.
func TestListUsageSummary_ReportsCountsPerList(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	used, err := cfg.CreateList("Used elsewhere", "", nil)
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}
	unused, err := cfg.CreateList("Unused", "", nil)
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}
	cfg.WireBoardReferenceLookup(func(entityKind, id string) []reference.ObjectRef {
		if entityKind == "list" && id == used.ID {
			return []reference.ObjectRef{{BoardID: "board-1", ObjectID: "object-1", Label: "Table"}}
		}
		return nil
	})

	usage := cfg.ListUsageSummary()
	byID := make(map[string]ListUsage, len(usage))
	for _, u := range usage {
		byID[u.ListID] = u
	}

	if got := byID[used.ID]; got.Boards != 1 || got.Workflows != 0 {
		t.Errorf("usage for the referenced list = %+v, want Boards:1 Workflows:0", got)
	}
	if got := byID[unused.ID]; got.Boards != 0 || got.Workflows != 0 {
		t.Errorf("usage for the unused list = %+v, want Boards:0 Workflows:0", got)
	}
}
