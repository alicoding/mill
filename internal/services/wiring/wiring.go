// Package wiring is composition-root code split out of main.go (the
// repo root keeps exactly one Go file): the cross-service seam
// adapters that connect one bounded context's injected-func seams to
// another's exported readers. It may import multiple service packages
// -- it IS the composition root's own code, not a service -- while the
// services themselves stay import-free of each other.
package wiring

import (
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
)

// WireAtlasProjections connects AtlasService's recognition (goal 0126)
// and List-projection (goal 0105) seams to Configure's and
// Composition's exported readers, adapting types at the boundary.
func WireAtlasProjections(atlas *atlassvc.AtlasService, cfg *configuresvc.ConfigureService, comp *compositionsvc.CompositionService) {
	atlas.WireSourceRecognition(
		func() []atlassvc.RecognizedIntegration {
			hosts := cfg.IntegrationHosts()
			out := make([]atlassvc.RecognizedIntegration, 0, len(hosts))
			for _, h := range hosts {
				out = append(out, atlassvc.RecognizedIntegration{RequestID: h.ID, Label: h.Label, Host: h.Host})
			}
			return out
		},
		func(requestID string) []atlassvc.OfferedAction {
			offers := comp.WorkflowsOfferingRequest(requestID)
			out := make([]atlassvc.OfferedAction, 0, len(offers))
			for _, o := range offers {
				out = append(out, atlassvc.OfferedAction{WorkflowID: o.ID, Label: o.Label})
			}
			return out
		},
	)
	atlas.WireListProjection(func(listID string) (atlassvc.ListProjection, bool) {
		label, cols, rows, ok := cfg.ListProjectionData(listID)
		if !ok {
			return atlassvc.ListProjection{}, false
		}
		proj := atlassvc.ListProjection{ListID: listID, Label: label}
		for _, c := range cols {
			proj.Columns = append(proj.Columns, atlassvc.ProjectionColumn{Key: c.Key, Label: c.Label, Options: c.Options, OptionColors: c.OptionColors})
		}
		for _, r := range rows {
			proj.Rows = append(proj.Rows, atlassvc.ProjectionRow{ID: r.ID, Status: r.Status, Values: r.Values})
		}
		return proj, true
	})
}
