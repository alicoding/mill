package atlassvc

import (
	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/seeding"
)

// The MCP-approval write plane's own entry points (ADR-0044's actor-
// scoping): CreateCard/UpdateCard/CreateLink are the exact same doors
// the UI calls with zero distinguishing session/context parameter
// (goal 0219 S0 finding) -- rather than inventing a session-identity
// system, mcpsvc.MillMCPService's approved-write executors call these
// PARALLEL entry points instead, so the ONLY thing that differs is
// which door was called (a purely static distinction, no shared
// mutable "current caller" state to race on). Same precedent
// CreateCardForWorkflow already established for the composition
// engine. Never bound as frontend RPCs.

//wails:ignore
func (a *AtlasService) CreateCardForMCP(kindID, title, note string, fields map[string]string, parentID string) (atlas.Card, error) {
	return a.createCardWithID(seeding.NewSlugID(title, "card"), kindID, title, note, fields, parentID, nil, "", "", "", "", "", "", actorMCP)
}

// UpdateCardForMCP shares UpdateCard's own updateCardCore (validation/
// persistence identical); only the recorded actor differs.
//
//wails:ignore
func (a *AtlasService) UpdateCardForMCP(id, title, note string, fields map[string]string, source, mirrorPath, refreshWorkflowID string) (atlas.Card, error) {
	c, previous, err := a.updateCardCore(id, title, note, fields, source, mirrorPath, refreshWorkflowID)
	if err != nil {
		return c, err
	}
	recordCardContentUndo(a, actorMCP, id, title, previous, c)
	return c, nil
}

//wails:ignore
func (a *AtlasService) CreateLinkForMCP(fromCardID, toCardID, linkKindID, label string) (atlas.Link, error) {
	newID := seeding.NewSlugID(label, "link")
	l, err := a.createLinkWithID(newID, fromCardID, toCardID, linkKindID, label)
	if err == nil && l.ID == newID {
		a.recordLinkCreateUndo(actorMCP, l)
	}
	return l, err
}
