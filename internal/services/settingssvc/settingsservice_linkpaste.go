package settingssvc

import (
	"strings"

	"github.com/alicoding/mill/internal/services/dataevent"
)

// preferredLinkPasteKindKey persists which claiming board-object kind a
// bare web link pasted on the board becomes when more than one enabled
// plugin claims links (ADR-0051 slice 2; the paste-provider preference
// the converged editors carry beside their "paste as…" chooser). One
// kind, not a ranking: with two claimants a preference IS the order,
// and the chooser after a paste covers the rest. Empty means "no
// preference" -- the chain's deterministic id order applies.
const preferredLinkPasteKindKey = "settings-preferred-link-paste-kind"

// GetPreferredLinkPasteKind returns the preferred claimant kind, or ""
// when the user never chose one. A kind whose plugin is disabled or
// gone is still returned as stored -- the paste chain's wiring simply
// finds no claim to promote, so the id order applies until the plugin
// is back.
func (s *SettingsService) GetPreferredLinkPasteKind() string {
	raw, _ := s.store.Get(preferredLinkPasteKindKey).(string)
	return strings.TrimSpace(raw)
}

// SetPreferredLinkPasteKind stores kind ("" clears the preference) and
// emits the extension dataevent so the Extensions page and the paste
// chain's next lookup both see it without a reload.
func (s *SettingsService) SetPreferredLinkPasteKind(kind string) error {
	if err := s.store.Set(preferredLinkPasteKindKey, strings.TrimSpace(kind)); err != nil {
		return err
	}
	dataevent.Emit("extension", "link-paste")
	return nil
}
