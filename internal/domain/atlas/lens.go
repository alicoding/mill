package atlas

import "encoding/json"

// LensSetting is one container card's per-space density filter (ADR-
// 0038's design principles): which Kind IDs stay hidden, and whether
// this level's children peek into THEIR own children too (docs/goals/
// 0061's "this level only vs peek into children" toggle, absorbed here
// from its previous browser-localStorage home so it round-trips across
// sessions/devices like every other Atlas preference).
type LensSetting struct {
	HiddenKindIDs []string
	Peek          bool
}

// IsZero reports whether s carries no real preference at all -- the
// service layer's signal to delete a container's map entry instead of
// persisting a no-op one (atlasservice.go's own "don't grow the
// persisted map with empty entries" rule, extended here from
// hidden-kinds-only to include Peek).
func (s LensSetting) IsZero() bool {
	return len(s.HiddenKindIDs) == 0 && !s.Peek
}

// UnmarshalJSON accepts the current object form ({"HiddenKindIDs":[...],
// "Peek":true}) and, forever, the pre-Peek wire shape a bare JSON array
// of hidden Kind IDs (every Lenses entry ever persisted before this
// field existed) -- additive per docs/goals/0061 slice C: an existing
// install's hidden-kind data keeps working unchanged, it simply upgrades
// to the object form the next time that container's lens is saved
// again.
func (s *LensSetting) UnmarshalJSON(data []byte) error {
	var legacy []string
	if err := json.Unmarshal(data, &legacy); err == nil {
		*s = LensSetting{HiddenKindIDs: legacy}
		return nil
	}
	var out struct {
		HiddenKindIDs []string
		Peek          bool
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return err
	}
	*s = LensSetting{HiddenKindIDs: out.HiddenKindIDs, Peek: out.Peek}
	return nil
}
