package windowing

import (
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// ConfigDir joins application.Path(application.PathConfigHome)'s
// OS-appropriate app-support directory with "mill" and elem -- the one
// place that convention lives, so main.go's own default-path
// construction (settings.json, execution.db, backups/, secrets.kdbx)
// can call this instead of every call site importing
// wails/v3/pkg/application directly (depguard: that import is confined
// to internal/adapters/ and main.go).
func ConfigDir(elem ...string) string {
	return filepath.Join(application.Path(application.PathConfigHome), filepath.Join(append([]string{"mill"}, elem...)...))
}

// ConfigDirOrEnv returns envVar's value if set (main.go's own per-data-
// file MILL_* isolation override convention, needed because server-mode
// and desktop-mode builds otherwise resolve to the identical real path
// -- MILL_SETTINGS_PATH's own doc comment in main.go has the full
// e2e-isolation reasoning), or ConfigDir(elem...) otherwise.
func ConfigDirOrEnv(envVar string, elem ...string) string {
	if v := os.Getenv(envVar); v != "" {
		return v
	}
	return ConfigDir(elem...)
}
