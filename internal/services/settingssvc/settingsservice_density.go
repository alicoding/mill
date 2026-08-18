package settingssvc

import "fmt"

// Split out of settingsservice.go, same "own file per self-contained
// concern" shape settingsservice_minutessaved.go already established.
// docs/goals/0096-display-density.md: an app-level appearance
// preference (Comfortable/Compact) that the frontend applies as a
// data-density attribute on each window's document root.

// displayDensityKey persists the preference as a single string value,
// no JSON envelope needed since the value itself is the whole
// preference (unlike summonHotkeyKey's multi-field blob).
const displayDensityKey = "settings-display-density"

// DisplayDensityComfortable/DisplayDensityCompact are the only two
// recognized values -- docs/goals/0096's locked Design states exactly
// two tiers, no third.
const (
	DisplayDensityComfortable = "comfortable"
	DisplayDensityCompact     = "compact"
)

// GetDisplayDensity returns the persisted preference, defaulting to
// Comfortable when unset or set to anything other than the one
// recognized override -- Comfortable is required to match today's
// unset behavior exactly (docs/goals/0096's "zero visual diff when
// unset" acceptance bar).
func (s *SettingsService) GetDisplayDensity() string {
	if v, ok := s.store.Get(displayDensityKey).(string); ok && v == DisplayDensityCompact {
		return DisplayDensityCompact
	}
	return DisplayDensityComfortable
}

// SetDisplayDensity persists the preference. Rejects any value besides
// the two locked tiers so a typo'd/future caller can't wedge the
// preference into a state no CSS selector matches.
func (s *SettingsService) SetDisplayDensity(density string) error {
	if density != DisplayDensityComfortable && density != DisplayDensityCompact {
		return fmt.Errorf("unknown display density %q", density)
	}
	if err := s.store.Set(displayDensityKey, density); err != nil {
		return fmt.Errorf("save display density: %w", err)
	}
	return nil
}
