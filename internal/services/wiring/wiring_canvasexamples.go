package wiring

import (
	"os"

	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/pluginsvc"
)

// WireCanvasObjectExamples seeds Board gallery with every valid
// plugin's declared canvasObjects[].example (goal 0411): the one seam
// that knows both atlassvc's gallery-reconcile shape and pluginsvc's
// manifest-claim shape, so neither service imports the other. Called
// once at boot, after PluginService has scanned its manifests -- the
// same "re-run reconcile once a dependency becomes available" order
// WireAtlasStorageDirs' SetCapturesDir call already established for
// captures-dir-backed goldens.
//
// MILL_SKIP_PLUGIN_EXAMPLE_SEED (e2e/fixtures/runtimePlugins.ts's own
// header comment has the full reasoning) opts a dedicated, single-
// plugin-mechanics test server OUT of this seed -- the same test-only-
// override shape MILL_TEST_DENSE_ATLAS already uses
// (atlasservice_builtin.go's populateDenseFixture), never set on a
// real install.
func WireCanvasObjectExamples(atlas *atlassvc.AtlasService, plugins *pluginsvc.PluginService) {
	if os.Getenv("MILL_SKIP_PLUGIN_EXAMPLE_SEED") != "" {
		return
	}
	claims := plugins.CanvasObjectExamples()
	examples := make([]atlassvc.PluginCanvasObjectExample, 0, len(claims))
	for _, c := range claims {
		fixtures := make([]atlassvc.PluginCanvasObjectExampleFixture, 0, len(c.Example.Fixtures))
		for _, f := range c.Example.Fixtures {
			fixtures = append(fixtures, atlassvc.PluginCanvasObjectExampleFixture{Kind: f.Kind, Body: f.Body, PayloadKey: f.PayloadKey})
		}
		examples = append(examples, atlassvc.PluginCanvasObjectExample{
			Kind: c.Kind, Title: c.Example.Title, Payload: c.Example.Payload, Revision: c.Example.Revision, Fixtures: fixtures,
		})
	}
	atlas.ReconcilePluginCanvasObjectExamples(examples)
}
