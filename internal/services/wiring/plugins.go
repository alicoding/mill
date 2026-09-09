package wiring

import (
	"log/slog"
	"net/http"

	"github.com/alicoding/mill/internal/adapters/secretaudit"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
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
// fixture-driven tests. auditDBPath opens the guarded-write audit
// trail's own connection (goal 0374) -- the SAME execution SQLite file
// mcpAuditService/bridgeService each connect to independently, folded
// into this one existing composition-root call rather than a second
// line in main.go.
func NewPluginService(settingsPath string, guardrail *guardrailsvc.GuardrailService, channel, appVersion, auditDBPath string, logger *slog.Logger) *pluginsvc.PluginService {
	dir := pluginsvc.ResolveDir(settingsPath)
	// A source build's version constant is the LAST release, not this
	// build's real lineage (main.go's build-stamp trio: only beta/
	// stable builds get stamped) -- enforcing minMillVersion against
	// it would refuse a pinned plugin on the freshest possible code,
	// so an unstamped build skips enforcement entirely.
	if channel == "source" {
		appVersion = ""
	}
	svc := pluginsvc.New(dir, guardrail, appVersion)
	svc.OpenAudit(auditDBPath, logger)
	return svc
}

// ComposedAssetMiddleware chains the remote-auth gate (server builds
// only -- AssetMiddleware's own doc) around the plugin asset route
// (both build modes: the desktop webview loads /plugins/<id>/main.js
// too), which falls through to the embedded bundle.
func ComposedAssetMiddleware(remoteAuth *remoteauthsvc.RemoteAuthService, plugins *pluginsvc.PluginService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		// The document policy (cspmiddleware.go) wraps everything so every
		// served document carries it, the remote-auth gate included; the
		// plugin-frame CORS header (cspmiddleware.go) rides the same
		// static-asset path the embedded bundle falls through to.
		return CSPMiddleware()(PluginFrameCORSMiddleware()(AssetMiddleware(remoteAuth)(plugins.AssetMiddleware()(next))))
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
	remoteAuth.SetNotificationService(notif)  // goal 0379: an incoming browser pair-request publishes through the spine
	WireUpdateEvents(settings, triggers)
	WirePluginTrust(plugins, settings, secrets)      // docs/adr/0051-platform-contract.md §4
	WirePluginIngestion(atlas, plugins, settings)    // docs/goals/0251-plugin-ingestion-claims.md
	WirePluginSecretRefs(plugins, secrets, settings) // docs/adr/0048-plugin-secret-references.md
}

// WirePluginEntityRefEvents connects an entityRef plugin setting's
// changed value to the entity.referenced/entity.dereferenced lifecycle
// events (docs/goals/0400): pluginsvc answers which setting is
// entityRef and its entityKind, configuresvc answers the live
// reference count after the change. Called once from main.go, after
// settingsService, pluginService, and configureService all exist.
func WirePluginEntityRefEvents(settings *settingssvc.SettingsService, plugins *pluginsvc.PluginService, cfg *configuresvc.ConfigureService) {
	settings.WireEntityReferenceEvents(plugins.EntityRefEntityKind, cfg.References)
}

// settingsTrust adapts SettingsService to the plugin service's trust
// reader (pluginsvc.PluginTrustReader).
type settingsTrust struct {
	settings *settingssvc.SettingsService
	// hashOf answers a plugin's current CodeHash ("" when unknown, docs/
	// goals/0375 S2); signedOK answers the signed tier's verdict; both
	// nil in the paste-chain wiring's own tests.
	hashOf   func(id string) string
	signedOK func(id string) bool
	// policyOK answers the organisation policy's verdict (goal 0349
	// S6); nil in the paste-chain wiring's own tests.
	policyOK func(id string) bool
	// widenedOf answers whether id currently declares more than its
	// recorded consent covers (docs/goals/0375 S2); nil in the
	// paste-chain wiring's own tests.
	widenedOf func(id string) bool
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

// GrantOf adapts the settings service's recorded grant to the plugin
// service's own shape (docs/goals/0375 S2) -- the pluginsvc package
// never imports settingssvc, so this is the one conversion seam.
func (t settingsTrust) GrantOf(id string) (pluginsvc.PluginGrant, bool) {
	entry, ok := t.settings.PluginGrant(id)
	if !ok {
		return pluginsvc.PluginGrant{}, false
	}
	return pluginsvc.PluginGrant{
		Capabilities: entry.Capabilities, Hosts: entry.Hosts, AnyHost: entry.AnyHost,
		Kinds: entry.Kinds, UsesSecrets: entry.UsesSecrets, CanvasHost: entry.CanvasHost,
	}, true
}

// pluginGrantSnapshotter builds the hasher SetPluginHasher installs: a
// plugin's version, its CodeHash (docs/goals/0375 S2 -- the trust
// lock's own comparison input, manifest.json excluded so a manifest
// edit alone never trips it), and its currently-declared grant shape,
// read off the SAME preview the Verification sheet shows -- there is
// exactly one place that computes "what this manifest declares".
func pluginGrantSnapshotter(plugins *pluginsvc.PluginService) settingssvc.PluginHasher {
	return func(id string) settingssvc.PluginGrantSnapshot {
		hash := plugins.CodeHashOf(id)
		if hash == "" {
			return settingssvc.PluginGrantSnapshot{}
		}
		version := plugins.VersionOf(id)
		pv, err := plugins.PreviewInstalled(id)
		if err != nil {
			return settingssvc.PluginGrantSnapshot{Version: version, Hash: hash}
		}
		return settingssvc.PluginGrantSnapshot{
			Version: version, Hash: hash,
			Capabilities: pv.Capabilities, Hosts: pv.NetworkHosts, AnyHost: pv.AnyHost,
			Kinds: pv.Kinds, UsesSecrets: pv.UsesSecrets, CanvasHost: pv.CanvasHost,
		}
	}
}

// unchanged reports whether the plugin's CodeHash still matches its
// consent (ADR-0051 §4 slice 5, narrowed by docs/goals/0375 S2 to
// exclude manifest.json -- a manifest edit is Widened's question, not
// this one) -- true with no hasher wired or nothing recorded.
func (t settingsTrust) unchanged(id string) bool {
	if t.hashOf == nil {
		return true
	}
	return t.settings.PluginLockMatches(id, t.hashOf(id))
}

// mayRun is the ONE run-policy predicate the Go side applies (the
// frontend loader mirrors it in plugins/pluginTrust.ts): a plugin must
// be on the administrator's allow-list when one is set, not turned off,
// allowed to run by the user after the install-time review, and not
// currently declaring more than that review covered (ADR-0051 §4,
// widened by docs/goals/0375 S2's re-consent-on-widen rule). A
// built-in skips every trust gate but never the user's own on/off
// switch.
func (t settingsTrust) mayRun(id string, builtin bool) bool {
	if !t.Enabled(id) {
		return false
	}
	if builtin {
		return true
	}
	if t.policyOK != nil && !t.policyOK(id) {
		return false
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
	if t.widenedOf != nil && t.widenedOf(id) {
		return false
	}
	return t.Allowed(id) && t.unchanged(id)
}

// WirePluginTrust grandfathers the plugins already installed the first
// time this instance boots with the run gate (every valid, non-built-in
// plugin present is recorded as allowed -- an upgrade never turns a
// working plugin off), and installs the audit export's read seams.
func WirePluginTrust(plugins *pluginsvc.PluginService, settings *settingssvc.SettingsService, secrets *secretsvc.SecretService) {
	settings.SetPluginHasher(pluginGrantSnapshotter(plugins))
	plugins.SetSigningKeys(settings.GetPluginSigningKeys)
	migratePluginLockFormat(plugins, settings)
	grandfatherInstalledPlugins(plugins, settings)
	trust := settingsTrust{settings: settings, hashOf: plugins.CodeHashOf, signedOK: plugins.SignedOK, policyOK: plugins.PolicyAllows, widenedOf: plugins.Widened}
	plugins.WireAudit(trust, pluginSecretAccessReader(secrets))
	// The step-pack door (ADR-0051 §5): every runnable plugin's declared
	// steps join the catalog and the executor, read fresh per lookup.
	plugins.SetRunPolicy(trust.mayRun)
	composition.SetExternalNodeTypeLookup(plugins.StepNodeTypes)
	// The secret-source door (goal 0306 S4): a plugin-backed source
	// lists and resolves through the plugin platform, and the secret
	// service applies what came back through its own unchanged provider
	// path. Behind the same run policy, so a source stops answering the
	// moment its extension is turned off.
	secrets.SetPluginSources(plugins)
	// Uninstall (goal 0321) belongs to the same consent lifecycle the
	// settings service already owns, so it holds the removal and this
	// hands it only the folder lookup -- settingssvc never depends on
	// pluginsvc.
	settings.WirePluginRemoval(func(id string) (string, bool, bool) {
		infos, err := plugins.ListPlugins()
		if err != nil {
			return "", false, false
		}
		for _, info := range infos {
			if info.Manifest.ID == id {
				return info.Dir, info.Builtin, true
			}
		}
		return "", false, false
	})
}

// migratePluginLockFormat re-baselines a lock entry recorded before
// docs/goals/0375 S2 split CodeHash off the whole-folder ContentHash
// (and introduced the capability-shaped grant fields in the same
// change): back then, consent was recorded at ContentHash with no
// grant shape at all, which now reads every entry as 'changed' AND
// 'widened' the instant an upgraded instance boots, even though the
// plugin's files never moved (docs/goals/0420). An entry whose Hash
// equals the plugin's CURRENT ContentHash but not its CodeHash
// predates the split; only the format changed, so the whole entry
// (hash and grant shape alike) re-baselines onto what the plugin
// currently declares. Anything else -- a genuine edit, a hasher
// WirePluginTrust has not run for yet -- is left exactly as recorded.
// Idempotent: once re-baselined, Hash equals CodeHash and the loop
// skips it on the next boot.
func migratePluginLockFormat(plugins *pluginsvc.PluginService, settings *settingssvc.SettingsService) {
	for id, entry := range settings.GetPluginLock() {
		if entry.Hash == "" {
			continue
		}
		codeHash := plugins.CodeHashOf(id)
		if codeHash == "" || entry.Hash == codeHash {
			continue
		}
		if entry.Hash != plugins.ContentHashOf(id) {
			continue
		}
		if err := settings.RecordPluginLockNow(id); err != nil {
			slog.Error("migrate plugin lock", "id", id, "error", err)
			continue
		}
		slog.Info("migrated plugin lock to code hash", "id", id)
	}
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

// TitleOf checks the vault's own entries first, then every enabled
// secret source's keys (goal 0408 S1) -- a plugin's secretRef setting
// accepts anything the picker offers, and the picker's own Sources
// group is exactly ListProviderSecrets.
func (r pluginSecretResolver) TitleOf(id string) (string, bool) {
	if entries, err := r.secrets.ListSecrets(); err == nil {
		for _, e := range entries {
			if e.ID == id {
				return e.Title, true
			}
		}
	}
	providers, err := r.secrets.ListProviderSecrets()
	if err != nil {
		return "", false
	}
	for _, e := range providers {
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
	trust := settingsTrust{settings: settings, hashOf: plugins.CodeHashOf, signedOK: plugins.SignedOK, policyOK: plugins.PolicyAllows, widenedOf: plugins.Widened}
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
