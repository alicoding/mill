package atlassvc

import (
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/contract"
	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// This file extends compositionservice_export.go's/configureservice_
// export.go's export/import pattern (ADR-0036) to the whole Atlas
// graph, as ONE envelope family ("atlas") rather than one family per
// entity type -- Atlas already treats Kinds/LinkKinds/Cards/Links as
// one cohesive graph persisted in a single storage blob
// (atlasservice.go's own "one atomic blob" reasoning), so a portable
// export is "the graph," the same unit the Configure-style per-entity
// families don't have an equivalent of. Every exported* type below
// mirrors its domain counterpart, dropping system-managed audit
// fields (CreatedAt/UpdatedAt/BuiltIn/Seed) exactly like every other
// exported* shape in this codebase.
//
// exportedCard omits MirrorPath/LastSyncedAt/ReceiptRunID deliberately:
// they're machine-written sync state, not authored config -- an
// imported card starts exactly like a freshly created one with a
// RefreshWorkflowID (or none), same posture ExecutionService's own
// receipt fields take. RefreshWorkflowID itself is also omitted,
// matching exportedDecision's WebhookRequestID precedent
// (configureservice_export.go): an imported card on a different Mill
// instance has no guarantee the referenced workflow id even exists
// there, so this is re-authored after import, the same as a secret.

type exportedKind struct {
	ID          string             `json:"id,omitempty"`
	Label       string             `json:"label"`
	Description string             `json:"description,omitempty"`
	Icon        string             `json:"icon,omitempty"`
	Fields      []typedfield.Field `json:"fields,omitempty"`
	// FieldTombstones round-trips this Kind's own deleted-Fields
	// history (docs/adr/0040 decision 3) -- exportedDecision/
	// exportedList's own identical field carries the same reasoning.
	FieldTombstones []typedfield.FieldTombstone `json:"fieldTombstones,omitempty"`
}

type exportedLinkKind struct {
	ID          string `json:"id,omitempty"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
}

type exportedPosition struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type exportedCard struct {
	ID       string            `json:"id,omitempty"`
	KindID   string            `json:"kindID"`
	Title    string            `json:"title"`
	Note     string            `json:"note,omitempty"`
	Fields   map[string]string `json:"fields,omitempty"`
	ParentID string            `json:"parentID,omitempty"`
	Position *exportedPosition `json:"position,omitempty"`
	ViewMode atlas.ViewMode    `json:"viewMode,omitempty"`
	Source   string            `json:"source,omitempty"`
}

type exportedLink struct {
	ID         string `json:"id,omitempty"`
	FromCardID string `json:"fromCardID"`
	ToCardID   string `json:"toCardID"`
	LinkKindID string `json:"linkKindID"`
	Label      string `json:"label,omitempty"`
}

// exportedAtlas is the one envelope (mill://schema/atlas/v1, ADR-0036
// decision 2) carrying the whole graph.
type exportedAtlas struct {
	Schema    string             `json:"schema"`
	Kinds     []exportedKind     `json:"kinds,omitempty"`
	LinkKinds []exportedLinkKind `json:"linkKinds,omitempty"`
	Cards     []exportedCard     `json:"cards,omitempty"`
	Links     []exportedLink     `json:"links,omitempty"`
}

// ExportAtlas serializes the whole Atlas graph as an indented, portable
// JSON string -- share it, commit it to git, or import it into another
// Mill instance. Read-only: never mutates a's state. Deterministic by
// construction (every field is already-stored data in stable slice
// order): exporting twice with no intervening change produces
// byte-identical bytes, the same guarantee every other exported* shape
// in this codebase carries.
func (a *AtlasService) ExportAtlas() (string, error) {
	a.mu.RLock()
	// A tombstoned card (goal 0093) must not resurrect via export ->
	// import on another instance -- liveCardsLocked already excludes
	// it and resolves a live child's effective ParentID.
	liveCards := a.liveCardsLocked()
	out := exportedAtlas{
		Schema:    contract.SchemaID("atlas"),
		Kinds:     make([]exportedKind, len(a.kinds)),
		LinkKinds: make([]exportedLinkKind, len(a.linkKinds)),
		Cards:     make([]exportedCard, len(liveCards)),
		Links:     make([]exportedLink, len(a.links)),
	}
	for i, k := range a.kinds {
		out.Kinds[i] = exportedKind{
			ID: k.ID, Label: k.Label, Description: k.Description, Icon: k.Icon,
			Fields: k.Fields, FieldTombstones: k.FieldTombstones,
		}
	}
	for i, lk := range a.linkKinds {
		out.LinkKinds[i] = exportedLinkKind{ID: lk.ID, Label: lk.Label, Description: lk.Description}
	}
	for i, c := range liveCards {
		var pos *exportedPosition
		if c.Position != nil {
			pos = &exportedPosition{X: c.Position.X, Y: c.Position.Y}
		}
		out.Cards[i] = exportedCard{
			ID: c.ID, KindID: c.KindID, Title: c.Title, Note: c.Note, Fields: c.Fields,
			ParentID: c.ParentID, Position: pos, ViewMode: c.ViewMode, Source: c.Source,
		}
	}
	liveCardIDs := make(map[string]bool, len(liveCards))
	for _, c := range liveCards {
		liveCardIDs[c.ID] = true
	}
	out.Links = out.Links[:0]
	for _, l := range a.links {
		// A link touching a tombstoned card (goal 0093) is never
		// exported -- the other end wouldn't exist locally on import.
		if !liveCardIDs[l.FromCardID] || !liveCardIDs[l.ToCardID] {
			continue
		}
		out.Links = append(out.Links, exportedLink{ID: l.ID, FromCardID: l.FromCardID, ToCardID: l.ToCardID, LinkKindID: l.LinkKindID, Label: l.Label})
	}
	a.mu.RUnlock()

	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return "", fmt.Errorf("export atlas: %w", err)
	}
	return string(data), nil
}

// AtlasImportSummary counts what ImportAtlas did, per family -- the
// frontend's own pre-import preview computes its "will update" warning
// client-side (existing entity ids, same shape useImportConfirm already
// reads for every other import surface), so this return value is purely
// informational for a post-import confirmation, not load-bearing for
// the uniform-semantics preview itself.
type AtlasImportSummary struct {
	KindsCreated     int
	KindsUpdated     int
	LinkKindsCreated int
	LinkKindsUpdated int
	CardsCreated     int
	CardsUpdated     int
	LinksCreated     int
	LinksUpdated     int
}

// ImportAtlas applies ADR-0036 decision 3's uniform import rule to
// EVERY entity inside jsonData's bundle independently: id absent ->
// create fresh; id present and known locally -> update in place; id
// present and unknown locally -> create preserving that id. Order is
// Kinds/LinkKinds first (Cards reference them by id), then Cards in two
// passes -- pass one creates/updates every card's own content with no
// containment yet (so a bundle can list a child before its parent),
// pass two applies ParentID/Position now that every bundled card exists
// locally, through the existing MoveCard/SetPosition chokepoints (their
// own cycle-rejection applies unchanged). A card whose bundle entry
// omits ParentID is left wherever it already is when updating an
// EXISTING card -- omitempty can't distinguish "explicitly root" from
// "field not declared" (the same nil-vs-empty ambiguity
// UpdateWorkflowFromExport's own doc comment already documents for
// Attributes/Notes), so import only ever ADDS/changes containment,
// never implicitly clears it. Links import last, once every card and
// LinkKind they reference exists.
func (a *AtlasService) ImportAtlas(jsonData string) (AtlasImportSummary, error) {
	var in exportedAtlas
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return AtlasImportSummary{}, fmt.Errorf("import atlas: invalid JSON: %w", err)
	}
	if err := contract.ValidateImportSchema("atlas", in.Schema); err != nil {
		return AtlasImportSummary{}, fmt.Errorf("import atlas: %w", err)
	}

	var summary AtlasImportSummary

	for _, k := range in.Kinds {
		created, err := a.importKind(k)
		if err != nil {
			return summary, fmt.Errorf("import atlas: kind %q: %w", k.Label, err)
		}
		if created {
			summary.KindsCreated++
		} else {
			summary.KindsUpdated++
		}
	}
	for _, lk := range in.LinkKinds {
		created, err := a.importLinkKind(lk)
		if err != nil {
			return summary, fmt.Errorf("import atlas: link kind %q: %w", lk.Label, err)
		}
		if created {
			summary.LinkKindsCreated++
		} else {
			summary.LinkKindsUpdated++
		}
	}

	type placement struct {
		id       string
		parentID string
		position *atlas.Position
	}
	placements := make([]placement, 0, len(in.Cards))
	for _, c := range in.Cards {
		id, created, err := a.importCardContent(c)
		if err != nil {
			return summary, fmt.Errorf("import atlas: card %q: %w", c.Title, err)
		}
		if created {
			summary.CardsCreated++
		} else {
			summary.CardsUpdated++
		}
		if c.ParentID != "" || c.Position != nil {
			var pos *atlas.Position
			if c.Position != nil {
				pos = &atlas.Position{X: c.Position.X, Y: c.Position.Y}
			}
			placements = append(placements, placement{id: id, parentID: c.ParentID, position: pos})
		}
	}
	for _, p := range placements {
		if p.parentID != "" {
			if _, err := a.MoveCard(p.id, p.parentID); err != nil {
				return summary, fmt.Errorf("import atlas: place card %q: %w", p.id, err)
			}
		}
		if p.position != nil {
			if _, err := a.SetPosition(p.id, p.position); err != nil {
				return summary, fmt.Errorf("import atlas: position card %q: %w", p.id, err)
			}
		}
	}

	for _, l := range in.Links {
		created, err := a.importLink(l)
		if err != nil {
			return summary, fmt.Errorf("import atlas: link %q: %w", l.Label, err)
		}
		if created {
			summary.LinksCreated++
		} else {
			summary.LinksUpdated++
		}
	}

	return summary, nil
}

func (a *AtlasService) importKind(k exportedKind) (created bool, err error) {
	if k.ID == "" {
		_, err = a.CreateKind(k.Label, k.Description, k.Icon, k.Fields)
		return true, err
	}
	a.mu.RLock()
	exists := a.findKindLocked(k.ID) != -1
	a.mu.RUnlock()
	if exists {
		_, err = a.UpdateKind(k.ID, k.Label, k.Description, k.Icon, k.Fields, k.FieldTombstones)
		return false, err
	}
	_, err = a.createKindWithID(k.ID, k.Label, k.Description, k.Icon, k.Fields, k.FieldTombstones)
	return true, err
}

func (a *AtlasService) importLinkKind(lk exportedLinkKind) (created bool, err error) {
	if lk.ID == "" {
		_, err = a.CreateLinkKind(lk.Label, lk.Description)
		return true, err
	}
	a.mu.RLock()
	exists := a.findLinkKindLocked(lk.ID) != -1
	a.mu.RUnlock()
	if exists {
		_, err = a.UpdateLinkKind(lk.ID, lk.Label, lk.Description)
		return false, err
	}
	_, err = a.createLinkKindWithID(lk.ID, lk.Label, lk.Description)
	return true, err
}

// importCardContent applies a bundled card's own content (never its
// containment -- see ImportAtlas's own doc comment) and returns the
// local id it now lives at.
func (a *AtlasService) importCardContent(c exportedCard) (string, bool, error) {
	if c.ID == "" {
		card, err := a.CreateCard(c.KindID, c.Title, c.Note, c.Fields, "", nil, c.ViewMode, c.Source, "", "")
		return card.ID, true, err
	}
	a.mu.RLock()
	exists := a.findCardLocked(c.ID) != -1
	a.mu.RUnlock()
	if exists {
		_, err := a.UpdateCard(c.ID, c.Title, c.Note, c.Fields, c.Source, "", "")
		return c.ID, false, err
	}
	card, err := a.createCardWithID(c.ID, c.KindID, c.Title, c.Note, c.Fields, "", nil, c.ViewMode, c.Source, "", "", "", "")
	return card.ID, true, err
}

func (a *AtlasService) importLink(l exportedLink) (created bool, err error) {
	if l.ID == "" {
		_, err = a.CreateLink(l.FromCardID, l.ToCardID, l.LinkKindID, l.Label)
		return true, err
	}
	a.mu.RLock()
	exists := a.findLinkLocked(l.ID) != -1
	a.mu.RUnlock()
	if exists {
		_, err = a.UpdateLink(l.ID, l.Label)
		return false, err
	}
	_, err = a.createLinkWithID(l.ID, l.FromCardID, l.ToCardID, l.LinkKindID, l.Label)
	return true, err
}
