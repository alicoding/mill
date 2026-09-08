package contract_test

import (
	"testing"

	"github.com/alicoding/mill/internal/contract"
)

// Every content contract names a kind and a read tool, and mcpsvc's
// own verb_noun naming rule (the plugin-standard rule this goal's own
// Acceptance restates): no tool here is named object.query/patch/
// replace/create -- the generic shape the goal's Precedent rejected.
func TestContentContracts_NameNoGenericObjectTool(t *testing.T) {
	banned := map[string]bool{
		"object.query": true, "object.patch": true, "object.replace": true, "object.create": true,
	}
	for _, c := range contract.ContentContracts {
		if c.Kind == "" {
			t.Error("a content contract has no kind")
		}
		if c.ReadTool == "" {
			t.Errorf("%s: no read tool named", c.Kind)
		}
		if banned[c.ReadTool] {
			t.Errorf("%s: read tool %q is the rejected generic shape", c.Kind, c.ReadTool)
		}
		if len(c.EditTools) == 0 {
			t.Errorf("%s: no edit tools named", c.Kind)
		}
		for _, tool := range c.EditTools {
			if banned[tool] {
				t.Errorf("%s: edit tool %q is the rejected generic shape", c.Kind, tool)
			}
		}
	}
}
