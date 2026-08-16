package settingssvc

import (
	"context"
	"fmt"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

// SetUpdater wires Wails3's own app.Updater singleton (constructed by
// application.New() itself, already Init'd by main.go with a GitHub
// Releases provider) -- set after app construction, same "wire the
// rest after construction" shape as SetWindow. docs/SPEC.md §3.7's
// research confirmed this needs no new dependency: v3/pkg/updater is
// Wails3's own first-party package.
//
//wails:ignore
func (s *SettingsService) SetUpdater(u *updater.Updater) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.updater = u
}

// UpdateCheckResult is CheckForUpdates' Wails-bound result shape.
type UpdateCheckResult struct {
	UpdateAvailable bool   `json:"updateAvailable"`
	Version         string `json:"version"`
	CurrentVersion  string `json:"currentVersion"`
	Notes           string `json:"notes"`
}

// CheckForUpdates asks the configured provider (GitHub Releases,
// alicoding/mill) whether a newer version exists. Inert until Mill has
// a real tagged-release process -- see docs/SPEC.md §3.7's own note on
// this; wired now so the mechanism exists, not claiming a working
// update pipeline exists yet.
// SetAppVersion records Mill's own release version for display; wired
// from main.go's millVersion const.
//
//wails:ignore
func (s *SettingsService) SetAppVersion(v string) {
	s.mu.Lock()
	s.appVersion = v
	s.mu.Unlock()
}

// AppVersion returns Mill's own release version (empty until wired).
func (s *SettingsService) AppVersion() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.appVersion
}

func (s *SettingsService) CheckForUpdates() (UpdateCheckResult, error) {
	s.mu.Lock()
	u := s.updater
	s.mu.Unlock()
	if u == nil {
		return UpdateCheckResult{}, fmt.Errorf("updater not configured")
	}
	rel, err := u.Check(context.Background())
	if err != nil {
		return UpdateCheckResult{}, err
	}
	if rel == nil {
		return UpdateCheckResult{UpdateAvailable: false, CurrentVersion: s.AppVersion()}, nil
	}
	return UpdateCheckResult{UpdateAvailable: true, Version: rel.Version, CurrentVersion: s.AppVersion(), Notes: rel.Notes}, nil
}
