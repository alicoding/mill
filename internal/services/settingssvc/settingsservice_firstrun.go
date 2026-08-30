package settingssvc

import "encoding/json"

// firstRunIntrosSeenKey persists the set of first-run intro ids the
// user has dismissed (the FirstRunIntro surface, goal 0202) as one
// JSON array -- the same atomic-blob shape disabledExtensionsKey
// already establishes. Server-side on purpose: "have they seen it"
// must survive server mode and a second device, so it can never live
// in per-viewer browser storage.
const firstRunIntrosSeenKey = "settings-first-run-intros-seen"

// GetSeenFirstRunIntros returns every intro id the user has dismissed.
// Never nil -- always at least an empty slice.
func (s *SettingsService) GetSeenFirstRunIntros() []string {
	raw, ok := s.store.Get(firstRunIntrosSeenKey).(string)
	if !ok || raw == "" {
		return []string{}
	}
	var ids []string
	if err := json.Unmarshal([]byte(raw), &ids); err != nil {
		return []string{}
	}
	return ids
}

// MarkFirstRunIntroSeen records one intro as dismissed. Idempotent --
// marking an already-seen id changes nothing. Seen state only ever
// transitions unseen->seen (there is no user-facing reset: an intro
// shows exactly once, ever), so no dataevent fires -- only the
// dismissing window's own state cares.
func (s *SettingsService) MarkFirstRunIntroSeen(id string) error {
	current := s.GetSeenFirstRunIntros()
	for _, existing := range current {
		if existing == id {
			return nil
		}
	}
	data, err := json.Marshal(append(current, id))
	if err != nil {
		return err
	}
	return s.store.Set(firstRunIntrosSeenKey, string(data))
}
