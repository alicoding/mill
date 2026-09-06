package pluginsvc

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/alicoding/mill/internal/adapters/osopen"
)

// perform executes an approved action on the plugin's behalf. Each
// capability's execution lives here, next to its vocabulary entry --
// the plugin's request never contained the primitive, only the ask.
func (p *PluginService) perform(kind string, attributes map[string]string) (bool, error) {
	if kind == "open-app" {
		app, path := strings.TrimSpace(attributes["app"]), strings.TrimSpace(attributes["path"])
		if app == "" || !filepath.IsAbs(path) {
			return false, fmt.Errorf("open-app needs an app name and an absolute path")
		}
		if err := osopen.OpenWith(app, path); errors.Is(err, osopen.ErrUnsupportedInServerMode) {
			return false, nil
		} else if err != nil {
			return false, fmt.Errorf("open in %s: %w", app, err)
		}
		return true, nil
	}
	if kind == "open-url" {
		u := attributes["url"]
		if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
			return false, fmt.Errorf("open-url only opens http(s) URLs")
		}
		if err := p.openInOS(u); errors.Is(err, osopen.ErrUnsupportedInServerMode) {
			// Approved but not performed: server mode has no browser to
			// open (the caller sees approved=true, performed=false).
			return false, nil
		} else if err != nil {
			return false, fmt.Errorf("open URL: %w", err)
		}
		return true, nil
	}
	return false, nil
}
