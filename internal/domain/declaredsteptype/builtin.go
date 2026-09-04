package declaredsteptype

import (
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// ExampleCheckHTTPBinID is the seeded example DeclaredStepType's ID --
// exported so composition.builtInDeclaredStepTypeWorkflows' own seeded
// workflow (goal 0054 slice A's seeded proof) can reference it without
// a string literal that could drift, same pattern
// execenv.ExampleSafeSandboxID/httprequest.ExampleNoneID already
// establish.
const ExampleCheckHTTPBinID = "example-check-httpbin-step"

// BuiltIn returns the seeded example DeclaredStepType -- pure config,
// no persistence (mirrors decision.BuiltIn/execenv.BuiltIn's shape:
// this package stays free of the settings-store concern, per
// CLAUDE.md's backend rule -- ConfigureService owns seeding/top-up).
//
// Promotes the seeded no-auth HTTPRequest example
// (httprequest.ExampleNoneID) into a named palette step -- the exact
// "designer v1 is largely PROMOTION" case docs/goals/0054 opens with,
// proving the data-backed registry end to end without needing any new
// engine or credential.
func BuiltIn() []DeclaredStepType {
	return []DeclaredStepType{
		{
			ID:           ExampleCheckHTTPBinID,
			Label:        "Check httpbin",
			Description:  "Calls the seeded no-auth httpbin.org integration and replaces the payload with its response. It is a named palette step bound to one fixed Integration, not a step you configure per use.",
			PaletteGroup: GroupActions,
			Engine:       EngineHTTP,
			RequestID:    httprequest.ExampleNoneID,
			BuiltIn:      true,
			Seed:         seedorigin.Stamp(1),
		},
	}
}
