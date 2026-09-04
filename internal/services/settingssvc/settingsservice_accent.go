package settingssvc

import "github.com/alicoding/mill/internal/adapters/systemaccent"

// The system accent color (goal 0320): an appearance value Mill reads
// rather than stores -- the user already chose it for their desktop, so
// Mill offers no picker of its own and persists nothing. Split into its
// own file the same way settingsservice_density.go is.

// GetSystemAccent returns the platform's accent color as the platform
// reports it ("rgb(r,g,b)" on macOS), or "" when there is none -- the
// frontend's signal to keep Mill's built-in accent (shared/accentScale.ts).
func (s *SettingsService) GetSystemAccent() string {
	return systemaccent.Read()
}
