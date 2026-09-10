package mcpsvc

import (
	"testing"

	"github.com/alicoding/mill/internal/services/servicetest"
)

// The inventory must equal what a real client sees: every tool
// registered at construction, none twice, sorted.
func TestBuiltInToolNames_ListsEveryRegisteredTool(t *testing.T) {
	names, err := BuiltInToolNames(servicetest.NewFakeStore())
	if err != nil {
		t.Fatalf("BuiltInToolNames: %v", err)
	}
	seen := map[string]bool{}
	for i, n := range names {
		if seen[n] {
			t.Errorf("tool %q listed twice", n)
		}
		seen[n] = true
		if i > 0 && names[i-1] > n {
			t.Errorf("names not sorted at %q", n)
		}
	}
	for _, want := range []string{
		"export_workflow", "import_workflow", "atlas_read_diagram", "list_plugins",
		"atlas_sheet_read_range", "atlas_sheet_edit_cells", "list_append_row",
		"secrets_list_references",
		"get_ai_provider_availability", "start_ai_provider_check", "cancel_ai_provider_check",
	} {
		if !seen[want] {
			t.Errorf("missing %q in %v", want, names)
		}
	}
}
