package atlassvc

import (
	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/reference"
)

// entityReferencesFn is configuresvc's combined board+workflow index
// (its own References method) -- injected so this package never
// imports configuresvc, the same seam shape listProjectionFn already
// uses for the opposite direction.
type entityReferencesFn func(entityKind, id string) reference.Refs

// WireEntityReferenceIndex injects the combined reference index.
// Called once from wiring.go, after both services exist.
//
//wails:ignore
func (a *AtlasService) WireEntityReferenceIndex(fn entityReferencesFn) {
	a.entityReferences = fn
}

// referenceLabelFor is a board object's own display name for an error
// or a Configure usage line that has to name it -- its own Payload
// title (every table-placing path sets one, atlascardactions.go/
// useAtlasTableObjectCreate.ts), falling back to its Kind for a golden
// or a legacy object with none.
func referenceLabelFor(o atlas.BoardObject) string {
	if title := o.Payload["title"]; title != "" {
		return title
	}
	return o.Kind
}

// ObjectsReferencing returns every LIVE board object whose declared
// entityRef payload key resolves to id under entityKind (docs/goals/
// 0392 Decision 3, the Atlas half of ADR-0040 decision 3's reverse
// lookup) -- configuresvc's References (wired via
// WireBoardReferenceLookup) and this package's own DeleteBoardObject
// both read it. A tombstoned object never carries a live reference, so
// a delete that already ran (DeletedAt set, persisted) is invisible to
// its own next call here without any exclusion parameter.
//
// Marked wails:ignore: an internal cross-service integrity read, not a
// frontend RPC -- the same posture WorkflowsReferencing already takes.
//
//wails:ignore
func (a *AtlasService) ObjectsReferencing(entityKind, id string) []reference.ObjectRef {
	if id == "" {
		return nil
	}
	a.mu.RLock()
	defer a.mu.RUnlock()
	var refs []reference.ObjectRef
	for _, o := range a.objects {
		if !o.DeletedAt.IsZero() {
			continue
		}
		decl, ok := atlas.BoardObjectKindDeclFor(o.Kind)
		if !ok || decl.EntityRef == nil || decl.EntityRef.EntityKind != entityKind {
			continue
		}
		if o.Payload[decl.EntityRef.PayloadKey] == id {
			refs = append(refs, reference.ObjectRef{BoardID: o.ParentID, ObjectID: o.ID, Label: referenceLabelFor(o)})
		}
	}
	return refs
}
