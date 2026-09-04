package pluginsvc

import (
	"fmt"
	"os"
	"path/filepath"
)

// The plugins-directory concern, split out of pluginservice.go along
// its own seam (the 500-line convention): where plugins live, and the
// two doors that hand that path to a user -- the Extensions page's
// "Open plugins folder" and the `mill plugin new` scaffold's next step.

// ResolveDir names the directory plugins are installed into, before
// any service exists: beside the settings file, unless MILL_PLUGINS_DIR
// overrides it. Both the service wiring and the `mill plugin` scaffold
// (which prints the path as its next step) resolve it through here, so
// the two can never name different folders.
func ResolveDir(settingsPath string) string {
	if dir := os.Getenv("MILL_PLUGINS_DIR"); dir != "" {
		return dir
	}
	return filepath.Join(filepath.Dir(settingsPath), "plugins")
}

// PluginsDir returns the directory plugins are installed into --
// the Extensions page's install story shows and reveals it. The
// directory is created on first ask so "open the folder" never lands
// on a missing path.
func (p *PluginService) PluginsDir() (string, error) {
	if err := os.MkdirAll(p.dir, 0o750); err != nil {
		return "", fmt.Errorf("create plugins directory: %w", err)
	}
	return p.dir, nil
}

// RevealPluginsDir opens the plugins directory in the OS file manager.
func (p *PluginService) RevealPluginsDir() error {
	dir, err := p.PluginsDir()
	if err != nil {
		return err
	}
	return p.openInOS("file://" + dir)
}
