package wiring

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/pluginsvc"
	"github.com/alicoding/mill/internal/services/remoteauthsvc"
)

// NewPluginService resolves the plugins directory and constructs the
// service (docs/goals/0249): plugins live beside the settings file
// (<data dir>/plugins/<id>/), so MILL_SETTINGS_PATH isolation covers
// plugins for free; MILL_PLUGINS_DIR overrides independently for
// fixture-driven tests.
func NewPluginService(settingsPath string, guardrail *guardrailsvc.GuardrailService) *pluginsvc.PluginService {
	dir := os.Getenv("MILL_PLUGINS_DIR")
	if dir == "" {
		dir = filepath.Join(filepath.Dir(settingsPath), "plugins")
	}
	return pluginsvc.New(dir, guardrail)
}

// ComposedAssetMiddleware chains the remote-auth gate (server builds
// only -- AssetMiddleware's own doc) around the plugin asset route
// (both build modes: the desktop webview loads /plugins/<id>/main.js
// too), which falls through to the embedded bundle.
func ComposedAssetMiddleware(remoteAuth *remoteauthsvc.RemoteAuthService, plugins *pluginsvc.PluginService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return AssetMiddleware(remoteAuth)(plugins.AssetMiddleware()(next))
	}
}
