package atlas

// EffectiveParentID resolves parentID to the nearest LIVE ancestor,
// walking up byID's ParentID chain past every tombstoned
// (DeletedAt-nonzero) card in between -- the read-time virtual
// promotion goal 0093's soft-delete relies on: a tombstoned
// container's own children keep their stored ParentID untouched until
// the boot-time purge does the real rewrite, so every listing/render
// calls this to resolve what they should appear filed under right
// now. Returns parentID unchanged once it names a live card, a card
// absent from byID, or "" (root). Cycle-guarded the same way
// WouldCycle is: a cycle elsewhere in the data must never hang this
// walk.
func EffectiveParentID(byID map[string]Card, parentID string) string {
	seen := make(map[string]bool)
	cur := parentID
	for cur != "" {
		if seen[cur] {
			return cur
		}
		seen[cur] = true
		c, ok := byID[cur]
		if !ok || c.DeletedAt.IsZero() {
			return cur
		}
		cur = c.ParentID
	}
	return cur
}
