package wiring

import (
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"github.com/alicoding/mill/internal/adapters/secretaudit"

	"github.com/alicoding/mill/internal/domain/composition"
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
		// The document policy (cspmiddleware.go) wraps everything so every
		// served document carries it, the remote-auth gate included.
		return CSPMiddleware()(AssetMiddleware(remoteAuth)(plugins.AssetMiddleware()(next)))
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
	WirePluginTrust(plugins, settings, secrets)      // docs/adr/0051-platform-contract.md §4
	WirePluginIngestion(atlas, plugins, settings)    // docs/goals/0251-plugin-ingestion-claims.md
	WirePluginSecretRefs(plugins, secrets, settings) // docs/adr/0048-plugin-secret-references.md
}

// settingsTrust adapts SettingsService to the plugin service's trust
// reader (pluginsvc.PluginTrustReader).
type settingsTrust struct {
	settings *settingssvc.SettingsService
	// hashOf answers a plugin's current content hash ("" when unknown);
	// signedOK answers the signed tier's verdict; both nil in the
	// paste-chain wiring's own tests.
	hashOf   func(id string) string
	signedOK func(id string) bool
}

func (t settingsTrust) Enabled(id string) bool {
	for _, d := range t.settings.GetDisabledExtensions() {
		if d == id {
			return false
		}
	}
	return true
}

func (t settingsTrust) Allowed(id string) bool {
	for _, a := range t.settings.GetAllowedPlugins() {
		if a == id {
			return true
		}
	}
	return false
}

func (t settingsTrust) Allowlist() []string { return t.settings.GetPluginAllowlist() }

func (t settingsTrust) LockedHash(id string) string { return t.settings.GetPluginLock()[id].Hash }

// unchanged reports whether the plugin's files still match the hash
// its consent covered (ADR-0051 §4, slice 5) -- true with no hasher
// wired or nothing recorded.
func (t settingsTrust) unchanged(id string) bool {
	if t.hashOf == nil {
		return true
	}
	return t.settings.PluginLockMatches(id, t.hashOf(id))
}

// mayRun is the ONE run-policy predicate the Go side applies (the
// frontend loader mirrors it in plugins/pluginTrust.ts): a plugin must
// be on the administrator's allow-list when one is set, not turned off,
// and allowed to run by the user after the install-time review
// (ADR-0051 §4). A built-in skips the two trust gates but never the
// user's own on/off switch.
func (t settingsTrust) mayRun(id string, builtin bool) bool {
	if !t.Enabled(id) {
		return false
	}
	if builtin {
		return true
	}
	if list := t.Allowlist(); len(list) > 0 {
		listed := false
		for _, a := range list {
			listed = listed || a == id
		}
		if !listed {
			return false
		}
	}
	if t.signedOK != nil && !t.signedOK(id) {
		return false
	}
	return t.Allowed(id) && t.unchanged(id)
}

// WirePluginTrust grandfathers the plugins already installed the first
// time this instance boots with the run gate (every valid, non-built-in
// plugin present is recorded as allowed -- an upgrade never turns a
// working plugin off), and installs the audit export's read seams.
func WirePluginTrust(plugins *pluginsvc.PluginService, settings *settingssvc.SettingsService, secrets *secretsvc.SecretService) {
	settings.SetPluginHasher(func(id string) (string, string) {
		return plugins.VersionOf(id), plugins.ContentHashOf(id)
	})
	plugins.SetSigningKeys(settings.GetPluginSigningKeys)
	grandfatherInstalledPlugins(plugins, settings)
	trust := settingsTrust{settings: settings, hashOf: plugins.ContentHashOf, signedOK: plugins.SignedOK}
	plugins.WireAudit(trust, pluginSecretAccessReader(secrets))
	// The step-pack door (ADR-0051 §5): every runnable plugin's declared
	// steps join the catalog and the executor, read fresh per lookup.
	plugins.SetRunPolicy(trust.mayRun)
	composition.SetExternalNodeTypeLookup(plugins.StepNodeTypes)
}

func grandfatherInstalledPlugins(plugins *pluginsvc.PluginService, settings *settingssvc.SettingsService) {
	infos, err := plugins.ListPlugins()
	if err != nil {
		return
	}
	ids := []string{}
	for _, info := range infos {
		if info.Error == "" && !info.Builtin {
			ids = append(ids, info.Manifest.ID)
		}
	}
	if _, err := settings.RecordAllowedPluginsIfUnset(ids); err != nil {
		slog.Error("record grandfathered plugins", "error", err)
	}
}

// pluginSecretAccessReader pages the whole secret-access history for
// one actor prefix into the export's row shape.
func pluginSecretAccessReader(secrets *secretsvc.SecretService) func(prefix string) ([]pluginsvc.PluginSecretAccess, error) {
	return func(prefix string) ([]pluginsvc.PluginSecretAccess, error) {
		var out []pluginsvc.PluginSecretAccess
		for offset := 0; ; {
			resp, err := secrets.ListSecretAccess(secretsvc.ListSecretAccessRequest{ActorPrefix: prefix, Limit: 500, Offset: offset})
			if err != nil {
				return nil, err
			}
			for _, r := range resp.Records {
				out = append(out, pluginsvc.PluginSecretAccess{Timestamp: r.Timestamp, Label: r.Label, Context: r.Context, Actor: r.Actor, Outcome: r.Outcome, Error: r.ErrorText})
			}
			offset += len(resp.Records)
			if len(resp.Records) == 0 || offset >= resp.Total {
				return out, nil
			}
		}
	}
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
// minus plugins that may not run (settingsTrust.mayRun: the SAME
// policy the frontend loader applies, so the paste chain and the tray
// agree on what "off" means) --
// in precedence order: the user's preferred kind (Settings >
// Extensions, ADR-0051 slice 2) first, then ListPlugins' id order.
func WirePluginIngestion(atlas *atlassvc.AtlasService, plugins *pluginsvc.PluginService, settings *settingssvc.SettingsService) {
	trust := settingsTrust{settings: settings, hashOf: plugins.ContentHashOf, signedOK: plugins.SignedOK}
	atlas.WirePluginPasteClaims(func() []atlassvc.PluginPasteClaim {
		return orderPasteClaims(plugins.URLPasteClaims(), func(c pluginsvc.IngestionClaim) bool { return trust.mayRun(c.PluginID, c.Builtin) }, settings.GetPreferredLinkPasteKind())
	})
}

// orderPasteClaims drops the claims of plugins that may not run and
// moves the preferred kind's claim to the front, keeping the given
// order otherwise. A preferred kind no running plugin claims changes
// nothing.
func orderPasteClaims(claims []pluginsvc.IngestionClaim, mayRun func(pluginsvc.IngestionClaim) bool, preferred string) []atlassvc.PluginPasteClaim {
	var out []atlassvc.PluginPasteClaim
	for _, c := range claims {
		if !mayRun(c) {
			continue
		}
		claim := atlassvc.PluginPasteClaim{Kind: c.Kind}
		if preferred != "" && c.Kind == preferred {
			out = append([]atlassvc.PluginPasteClaim{claim}, out...)
			continue
		}
		out = append(out, claim)
	}
	return out
}
