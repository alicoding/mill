package wiring

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/alicoding/mill/internal/adapters/secretaudit"

	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/notificationsvc"
	"github.com/alicoding/mill/internal/services/pluginsvc"
	"github.com/alicoding/mill/internal/services/remoteauthsvc"
	"github.com/alicoding/mill/internal/services/secretsvc"
	"github.com/alicoding/mill/internal/services/settingssvc"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

// NewPluginService resolves the plugins directory and constructs the
// service (docs/goals/0249): plugins live beside the settings file
// (<data dir>/plugins/<id>/), so MILL_SETTINGS_PATH isolation covers
// plugins for free; MILL_PLUGINS_DIR overrides independently for
// fixture-driven tests.
func NewPluginService(settingsPath string, guardrail *guardrailsvc.GuardrailService, channel, appVersion string) *pluginsvc.PluginService {
	dir := os.Getenv("MILL_PLUGINS_DIR")
	if dir == "" {
		dir = filepath.Join(filepath.Dir(settingsPath), "plugins")
	}
	// A source build's version constant is the LAST release, not this
	// build's real lineage (main.go's build-stamp trio: only beta/
	// stable builds get stamped) -- enforcing minMillVersion against
	// it would refuse a pinned plugin on the freshest possible code,
	// so an unstamped build skips enforcement entirely.
	if channel == "source" {
		appVersion = ""
	}
	return pluginsvc.New(dir, guardrail, appVersion)
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

// WireSettingsEraSeams bundles the cross-service seams that can only
// exist once SettingsService is constructed (main.go calls it as one
// line right after that construction -- composition-root grouping,
// the backupsvc.Wire shape): notification channels, the phone
// channel, update trigger events, and plugin ingestion claims.
func WireSettingsEraSeams(settings *settingssvc.SettingsService, notif *notificationsvc.NotificationService, remoteAuth *remoteauthsvc.RemoteAuthService, triggers *triggersvc.TriggerService, atlas *atlassvc.AtlasService, plugins *pluginsvc.PluginService, secrets *secretsvc.SecretService) {
	WireNotificationChannels(settings, notif) // docs/goals/0171-notification-spine.md
	WirePhoneChannel(remoteAuth, notif)       // docs/goals/0132-remote-access.md SLICE B
	WireUpdateEvents(settings, triggers)
	WirePluginIngestion(atlas, plugins, settings)    // docs/goals/0251-plugin-ingestion-claims.md
	WirePluginSecretRefs(plugins, secrets, settings) // docs/adr/0048-plugin-secret-references.md
}

// WirePluginSecretRefs connects the secretRef door (ADR-0048) to the
// vault and the extension-settings blob: a title lookup that never
// decrypts, and a resolve that leaves the audit line under
// plugin:<id> -- the same store every other vault read writes to.
func WirePluginSecretRefs(plugins *pluginsvc.PluginService, secrets *secretsvc.SecretService, settings *settingssvc.SettingsService) {
	plugins.WireSecretRefs(pluginSecretResolver{secrets: secrets}, func(pluginID, key string) (string, bool) {
		v, ok := settings.GetExtensionSettings()[pluginID][key]
		return v, ok
	})
}

type pluginSecretResolver struct{ secrets *secretsvc.SecretService }

func (r pluginSecretResolver) TitleOf(id string) (string, bool) {
	entries, err := r.secrets.ListSecrets()
	if err != nil {
		return "", false
	}
	for _, e := range entries {
		if e.ID == id {
			return e.Title, true
		}
	}
	return "", false
}

func (r pluginSecretResolver) Resolve(id, pluginID string) (string, error) {
	return r.secrets.ResolveSecretValue(id, secretaudit.AccessContext{Context: secretaudit.ContextPluginFetch, Actor: "plugin:" + pluginID})
}

// WirePluginIngestion connects the paste chain's plugin-claims seam
// (docs/goals/0251): every valid manifest claiming bare-URL pastes,
// minus plugins the user has turned off -- the SAME disabled-
// extensions list the frontend loader consults, keyed by plugin id,
// so both ingestion chains and the tray agree on what "off" means.
func WirePluginIngestion(atlas *atlassvc.AtlasService, plugins *pluginsvc.PluginService, settings *settingssvc.SettingsService) {
	atlas.WirePluginPasteClaims(func() []atlassvc.PluginPasteClaim {
		disabled := map[string]bool{}
		for _, id := range settings.GetDisabledExtensions() {
			disabled[id] = true
		}
		var out []atlassvc.PluginPasteClaim
		for _, c := range plugins.URLPasteClaims() {
			if !disabled[c.PluginID] {
				out = append(out, atlassvc.PluginPasteClaim{Kind: c.Kind})
			}
		}
		return out
	})
}
