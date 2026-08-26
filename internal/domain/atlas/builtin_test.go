package atlas

import "testing"

// TestBuiltIns_AreInternallyConsistent pins the seeded example space's
// referential shape: every seeded Card names a seeded Kind, every
// seeded Card's ParentID (when set) names another seeded Card, and
// every seeded Link names seeded cards and a seeded LinkKind -- the
// property atlassvc's reconcile relies on to insert them without a
// referential-integrity error.
func TestBuiltIns_AreInternallyConsistent(t *testing.T) {
	kindByID := map[string]Kind{}
	for _, k := range BuiltInKinds() {
		if err := ValidateKind(k); err != nil {
			t.Errorf("seeded kind %q fails ValidateKind: %v", k.ID, err)
		}
		kindByID[k.ID] = k
	}
	linkKindByID := map[string]LinkKind{}
	for _, lk := range BuiltInLinkKinds() {
		if err := ValidateLinkKind(lk); err != nil {
			t.Errorf("seeded link kind %q fails ValidateLinkKind: %v", lk.ID, err)
		}
		linkKindByID[lk.ID] = lk
	}

	cardByID := map[string]Card{}
	for _, c := range BuiltInCards() {
		cardByID[c.ID] = c
	}
	for _, c := range cardByID {
		kind, ok := kindByID[c.KindID]
		if !ok {
			t.Errorf("seeded card %q names unknown kind %q", c.ID, c.KindID)
			continue
		}
		if err := ValidateCard(c, kind); err != nil {
			t.Errorf("seeded card %q fails ValidateCard: %v", c.ID, err)
		}
		if c.ParentID != "" {
			if _, ok := cardByID[c.ParentID]; !ok {
				t.Errorf("seeded card %q names unknown parent %q", c.ID, c.ParentID)
			}
		}
	}

	for _, l := range BuiltInLinks() {
		if err := ValidateLink(l); err != nil {
			t.Errorf("seeded link %q fails ValidateLink: %v", l.ID, err)
		}
		if _, ok := cardByID[l.FromCardID]; !ok {
			t.Errorf("seeded link %q names unknown from-card %q", l.ID, l.FromCardID)
		}
		if _, ok := cardByID[l.ToCardID]; !ok {
			t.Errorf("seeded link %q names unknown to-card %q", l.ID, l.ToCardID)
		}
		if _, ok := linkKindByID[l.LinkKindID]; !ok {
			t.Errorf("seeded link %q names unknown link kind %q", l.ID, l.LinkKindID)
		}
	}

	objectIDs := map[string]bool{}
	for _, o := range BuiltInBoardObjects() {
		if objectIDs[o.ID] {
			t.Errorf("seeded board object id %q repeats", o.ID)
		}
		objectIDs[o.ID] = true
		if err := ValidateBoardObject(o); err != nil {
			t.Errorf("seeded board object %q fails ValidateBoardObject: %v", o.ID, err)
		}
		if _, ok := cardByID[o.ParentID]; !ok {
			t.Errorf("seeded board object %q names unknown parent %q", o.ID, o.ParentID)
		}
		if !o.Seed.IsSeeded() || o.Seed.Modified {
			t.Errorf("seeded board object %q Seed = %+v, want an unmodified seeded origin", o.ID, o.Seed)
		}
	}

	// The seeded space's containment/view-mode shape: one root
	// container in canvas mode, root-level (no parent).
	root, ok := cardByID[cardMySpaceID]
	if !ok {
		t.Fatal("seeded root container card is missing")
	}
	if root.ParentID != "" {
		t.Errorf("seeded root container has ParentID %q, want root-level (empty)", root.ParentID)
	}
	if root.EffectiveViewMode() != ViewModeCanvas {
		t.Errorf("seeded root container view mode = %q, want canvas", root.EffectiveViewMode())
	}
}
