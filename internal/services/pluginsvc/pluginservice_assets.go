package pluginsvc

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// assetExtensions is the allowlist of file types a plugin folder may
// serve to the webview. Everything else 404s -- the plugins directory
// sits in user data, and this route must never become a generic file
// server over it.
var assetExtensions = map[string]string{
	".js":   "text/javascript; charset=utf-8",
	".css":  "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
}

// AssetMiddleware serves GET /plugins/<id>/<file> from the scanned
// plugins directory and passes every other request through.
func (p *PluginService) AssetMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			rest, isPluginPath := strings.CutPrefix(r.URL.Path, "/plugins/")
			if !isPluginPath || r.Method != http.MethodGet {
				next.ServeHTTP(w, r)
				return
			}
			full, contentType, ok := p.resolveAsset(rest)
			if !ok {
				http.NotFound(w, r)
				return
			}
			data, err := os.ReadFile(full) // #nosec G304 G703 -- full is Rel-verified inside the id's own validated plugin folder (resolveAsset)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", contentType)
			// The loader appends the plugin version as a query param, so
			// a reinstall busts any intermediary cache naturally.
			w.Header().Set("Cache-Control", "no-cache")
			_, _ = w.Write(data) // #nosec G705 -- served under the allowlisted Content-Type set above, from the user's own plugins directory
		})
	}
}

// resolveAsset validates <id>/<file> and returns the on-disk path and
// content type. Only ids that scan to a VALID manifest serve at all (a
// broken plugin is visible in Extensions, never half-loaded via a
// dangling script URL), only allowlisted extensions serve, and the
// resolved path must stay inside the plugin's own folder
// (filepath.Rel guards traversal after cleaning).
func (p *PluginService) resolveAsset(rest string) (full, contentType string, ok bool) {
	id, file, hasFile := strings.Cut(rest, "/")
	if !hasFile || file == "" || !pluginIDPattern.MatchString(id) {
		return "", "", false
	}
	if info := p.scanOne(id); info.Error != "" {
		return "", "", false
	}
	contentType, allowed := assetExtensions[strings.ToLower(filepath.Ext(file))]
	if !allowed {
		return "", "", false
	}
	pluginDir := filepath.Join(p.dir, id)
	full = filepath.Join(pluginDir, filepath.FromSlash(file))
	rel, err := filepath.Rel(pluginDir, full)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", "", false
	}
	return full, contentType, true
}
