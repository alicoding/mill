package atlassvc

// The id -> family index behind dataevent's "atlas" resolver
// (docs/goals/0357): every atlas live-sync event names WHICH family
// inside the blob changed ("card", "kind", "note", "link", "linkKind",
// "perspective", or a board object's own kind string -- the same
// vocabulary the content index's ContentEntry.Kind uses), so a
// subscriber (the plugin frame bridge) can skip every mutation its
// own listing never reads, resolved once at Emit's fan-out rather
// than re-derived per listener.
//
// Append-only and read without a.mu on purpose: Emit sites fire AFTER
// the mutation, some while a deferred a.mu write-lock is still held
// (SetCardActions), so the resolver may never take it. The map is kept
// in step at the two chokepoints the whole state already passes
// through -- restore and persistLocked -- and a delete's id stays
// indexed, so a delete's own event still names its family.

// entityKindFamilies are the structural families the index names; an
// object resolves to its own kind instead.
const (
	entityKindCard        = "card"
	entityKindKind        = "kind"
	entityKindNote        = "note"
	entityKindLink        = "link"
	entityKindLinkKind    = "linkKind"
	entityKindPerspective = "perspective"
)

// indexEntityKindsLocked refreshes the append-only index from the
// full state -- caller must hold a.mu (both call sites do).
func (a *AtlasService) indexEntityKindsLocked() {
	for _, k := range a.kinds {
		a.entityKinds.Store(k.ID, entityKindKind)
	}
	for _, lk := range a.linkKinds {
		a.entityKinds.Store(lk.ID, entityKindLinkKind)
	}
	for _, c := range a.cards {
		a.entityKinds.Store(c.ID, entityKindCard)
	}
	for _, l := range a.links {
		a.entityKinds.Store(l.ID, entityKindLink)
	}
	for _, n := range a.notes {
		a.entityKinds.Store(n.ID, entityKindNote)
	}
	for _, o := range a.objects {
		a.entityKinds.Store(o.ID, o.Kind)
	}
	for _, p := range a.perspectives {
		a.entityKinds.Store(p.ID, entityKindPerspective)
	}
}

// dataeventKindOf is the resolver dataevent's "atlas" events call:
// lock-free, answering "" for an id the index has never seen.
func (a *AtlasService) dataeventKindOf(id string) string {
	kind, _ := a.entityKinds.Load(id)
	family, _ := kind.(string)
	return family
}
