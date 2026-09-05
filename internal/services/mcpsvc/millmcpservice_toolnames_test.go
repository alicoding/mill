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
	for _, want := range []string{"export_workflow", "import_workflow", "atlas_read_diagram", "list_plugins"} {
		if !seen[want] {
			t.Errorf("missing %q in %v", want, names)
		}
	}
}
