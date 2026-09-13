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
	policyOK               func(id string) bool
	packageApprovalMatches func(id, codeHash string, granted pluginsvc.PluginGrant) bool
}

func (t settingsTrust) Enabled(id string) bool {
	for _, d := range t.settings.GetDisabledExtensions() {
		if d == id {
			return false
		}
	}
	return true
}

func (t settingsTrust) Allowlist() []string { return t.settings.GetPluginAllowlist() }

func (t settingsTrust) Approval() (pluginsvc.PluginApproval, error) {
	snapshot, err := settingssvc.ReadPluginApprovalSnapshot(t.settings)
	if err != nil {
		return pluginsvc.PluginApproval{}, err
	}
	out := pluginsvc.PluginApproval{
		Revision: snapshot.Revision, Allowed: append([]string(nil), snapshot.Allowed...), Locks: make(map[string]pluginsvc.PluginApprovalLock, len(snapshot.Locks)),
		LegacyUnpinned: append([]string(nil), snapshot.LegacyUnpinned...),
	}
	for id, entry := range snapshot.Locks {
		out.Locks[id] = pluginsvc.PluginApprovalLock{
			Version: entry.Version, Hash: entry.Hash,
			Grant: pluginsvc.PluginGrant{
				Capabilities: append([]string(nil), entry.Capabilities...), Hosts: append([]string(nil), entry.Hosts...), AnyHost: entry.AnyHost,
				NetworkGrantVersion: entry.NetworkGrantVersion, NetworkMethods: cloneNetworkMethods(entry.NetworkMethods),
				Kinds: append([]string(nil), entry.Kinds...), UsesSecrets: entry.UsesSecrets, CanvasHost: entry.CanvasHost,
			},
		}
	}
	return out, nil
}

// pluginGrantSnapshotter builds the hasher SetPluginHasher installs: a
// plugin's version, its CodeHash (docs/goals/0375 S2 -- the trust
// lock's own comparison input, manifest.json excluded so a manifest
// edit alone never trips it), and its currently-declared grant shape,
// read off the SAME preview the Verification sheet shows -- there is
// exactly one place that computes "what this manifest declares".
func pluginGrantSnapshotter(plugins *pluginsvc.PluginService) settingssvc.PluginHasher {
	return func(id string) (settingssvc.PluginGrantSnapshot, error) {
		version, hash, grant, err := pluginsvc.CaptureGrantLocked(plugins, id)
		if err != nil {
			return settingssvc.PluginGrantSnapshot{}, err
		}
		return settingssvc.PluginGrantSnapshot{
			Version: version, Hash: hash,
			Capabilities: grant.Capabilities, Hosts: grant.Hosts, AnyHost: grant.AnyHost,
			NetworkGrantVersion: grant.NetworkGrantVersion, NetworkMethods: cloneNetworkMethods(grant.NetworkMethods),
			Kinds: grant.Kinds, UsesSecrets: grant.UsesSecrets, CanvasHost: grant.CanvasHost,
		}, nil
	}
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
	approval, err := t.Approval()
	if err != nil {
		return false
	}
	lock, locked := approval.Locks[id]
	allowed := false
	for _, approved := range approval.Allowed {
		allowed = allowed || approved == id
	}
	if !allowed {
		return false
	}
	if !locked {
		return containsID(approval.LegacyUnpinned, id) && t.hashOf != nil && t.hashOf(id) != ""
	}
	if t.packageApprovalMatches == nil {
		return false
	}
	return t.packageApprovalMatches(id, lock.Hash, lock.Grant)
}

func containsID(ids []string, id string) bool {
	for _, candidate := range ids {
		if candidate == id {
			return true
		}
	}
	return false
}

// WirePluginTrust grandfathers the plugins already installed the first
// time this instance boots with the run gate (every valid, non-built-in
// plugin present is recorded as allowed -- an upgrade never turns a
// working plugin off), and installs the audit export's read seams.
func WirePluginTrust(plugins *pluginsvc.PluginService, settings *settingssvc.SettingsService, secrets *secretsvc.SecretService) {
	settingssvc.SetPluginApprovalStore(settings,
		func() ([]byte, int64, bool, error) { return pluginsvc.LoadApprovalState(plugins) },
		func(initializer settingssvc.PluginApprovalInitializer, change settingssvc.PluginApprovalChange) ([]byte, int64, error) {
			return pluginsvc.UpdateApprovalState(plugins, func() ([]byte, error) { return initializer() }, func(current []byte) ([]byte, error) { return change(current) })
		},
	)
	settings.SetPluginHasher(pluginGrantSnapshotter(plugins))
	plugins.SetSigningKeys(settings.GetPluginSigningKeys)
	// Settings owns the approval transition and PluginService owns package
	// mutation, so grandfathering needs this shared lock seam before it records
	// the packages that were already present at upgrade time.
	settingssvc.WirePluginRemoval(settings, func(id string, action func(string, bool, bool) error) error {
		return pluginsvc.WithPluginMutation(plugins, id, action)
	})
	grandfatherInstalledPlugins(plugins, settings)
	trust := pluginSettingsTrust(plugins, settings)
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
}

func pluginSettingsTrust(plugins *pluginsvc.PluginService, settings *settingssvc.SettingsService) settingsTrust {
	return settingsTrust{
		settings: settings, hashOf: plugins.CodeHashOf, signedOK: plugins.SignedOK, policyOK: plugins.PolicyAllows,
		packageApprovalMatches: func(id, hash string, grant pluginsvc.PluginGrant) bool {
			return pluginsvc.PackageApprovalMatches(plugins, id, hash, grant)
		},
	}
}

func cloneNetworkMethods(methods map[string][]string) map[string][]string {
	out := make(map[string][]string, len(methods))
	for host, values := range methods {
		out[host] = append([]string(nil), values...)
	}
	return out
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
	trust := pluginSettingsTrust(plugins, settings)
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
