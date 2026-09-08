package wiring

import "github.com/alicoding/mill/internal/services/settingssvc"

// ResolveAndWireUpdateChannel resolves the effective update channel
// (the user's persisted preference wins over the build stamp) and
// records BOTH it and the raw build stamp on s -- the latter is what
// the auto-download policy's local-build guard reads (goal 0403 S2d),
// since a preference override must never let a locally built binary's
// background auto-download run. Returns the resolved channel, which
// main.go still needs for InitUpdater's own CurrentVersion/Prerelease
// wiring.
func ResolveAndWireUpdateChannel(s *settingssvc.SettingsService, buildChannel string) string {
	effectiveChannel := s.ResolveUpdateChannel(buildChannel)
	s.SetUpdateChannel(effectiveChannel)
	s.SetBuildChannel(buildChannel)
	return effectiveChannel
}
