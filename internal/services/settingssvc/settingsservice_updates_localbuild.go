package settingssvc

// buildChannel's own stamping/query pair -- split out of
// settingsservice_updatenotice.go at the 500-line convention, the same
// per-concern-file shape as settingsservice_updates_auto.go.

import "os"

// SetBuildChannel records the channel this binary was compiled with --
// wired from main.go with the RAW millChannel value, never
// ResolveUpdateChannel's preference-applied result (see buildChannel's
// own field comment for why the distinction matters). testUpdateChannelEnv
// wins here too, the same override SetUpdateChannel honors, so an e2e
// run simulating a beta/release build via that env var also exercises
// triggerAutoDownloadPolicy's automatic-apply path exactly like a real
// one would.
//
//wails:ignore
func (s *SettingsService) SetBuildChannel(channel string) {
	if v := os.Getenv(testUpdateChannelEnv); v != "" {
		channel = v
	}
	s.mu.Lock()
	s.buildChannel = channel
	s.mu.Unlock()
}

// isLocalBuild reports whether this binary's build-time channel stamp
// identifies it as a local build (task dev/package/install:app) rather
// than a CI-produced release or beta artifact -- triggerAutoDownloadPolicy's
// own guard against silently swapping out a build under manual
// verification (goal 0403 S2d). An unset buildChannel (a SettingsService
// built directly by a test, without main.go's wiring) is never treated
// as local -- only an explicit non-release, non-beta stamp is.
func (s *SettingsService) isLocalBuild() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return localBuildForChannel(s.buildChannel)
}

func localBuildForChannel(channel string) bool {
	return channel != "" && channel != "release" && channel != "beta"
}
