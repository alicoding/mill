package pluginsvc

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/domain/secret"
)

// The secretRef door on the network door (ADR-0048, goal 0281): a
// plugin names a vault entry through one of its own declared
// secretRef settings, and Mill attaches that entry's value to the
// request HOST-side -- after the guardrail approved it -- then
// redacts the value from everything handed back. Plugin code never
// sees the value; the audit records the read under plugin:<id>.

// PluginFetchSecret is api.fetch's init.secret: WHICH setting names
// the entry, and how it travels (default: Authorization: Bearer …).
type PluginFetchSecret struct {
	SettingKey string `json:"settingKey"`
	Header     string `json:"header"`
	Prefix     string `json:"prefix"`
}

// SecretRefResolver is the vault seam the composition root wires.
// TitleOf never decrypts or audits -- it names the entry for the
// guardrail attribute and the Review description BEFORE any decision;
// Resolve decrypts and leaves the audit line, and is only ever called
// after approval.
type SecretRefResolver interface {
	TitleOf(id string) (string, bool)
	Resolve(id, pluginID string) (string, error)
}

// SettingReader answers a plugin's stored setting value as its JSON
// literal (settingssvc's extension-settings blob), ok=false when the
// user never set it.
type SettingReader func(pluginID, key string) (string, bool)

// WireSecretRefs connects the vault and the settings blob.
//
//wails:ignore
func (p *PluginService) WireSecretRefs(resolver SecretRefResolver, read SettingReader) {
	p.secretRefs = resolver
	p.readSetting = read
}

const (
	defaultSecretHeader = "Authorization"
	defaultSecretPrefix = "Bearer "
)

// ErrSecretRefUnset / ErrSecretRefGone are the two user-facing
// refusals a fetch naming a secret can hit before any rule runs; the
// Extensions row states the same words.
const (
	msgSecretRefUnset = "no secret is picked for this setting yet -- choose one in Settings > Extensions"
	msgSecretRefGone  = "the secret this setting names no longer exists -- pick another in Settings > Extensions"
)

type fetchSecret struct {
	id, title, header, prefix string
}

// secretForFetch validates the ask fail-closed, before the guardrail:
// the setting must be a declared secretRef, must have a picked entry,
// and that entry must still exist.
func (p *PluginService) secretForFetch(plugin PluginInfo, req PluginFetchRequest) (*fetchSecret, error) {
	if req.Secret == nil {
		return nil, nil
	}
	key := strings.TrimSpace(req.Secret.SettingKey)
	var declared *SettingContribution
	for i := range plugin.Manifest.Contributes.Settings {
		if plugin.Manifest.Contributes.Settings[i].Key == key {
			declared = &plugin.Manifest.Contributes.Settings[i]
		}
	}
	if declared == nil || declared.Type != SettingTypeSecretRef {
		return nil, fmt.Errorf("plugin %q: setting %q is not a declared secretRef setting", plugin.Manifest.ID, key)
	}
	if p.secretRefs == nil || p.readSetting == nil {
		return nil, fmt.Errorf("plugin %q: the vault is not available to extensions in this mode", plugin.Manifest.ID)
	}
	literal, ok := p.readSetting(plugin.Manifest.ID, key)
	var id string
	if ok {
		_ = json.Unmarshal([]byte(literal), &id)
	}
	if strings.TrimSpace(id) == "" {
		return nil, fmt.Errorf("plugin %q: %s", plugin.Manifest.ID, msgSecretRefUnset)
	}
	title, exists := p.secretRefs.TitleOf(id)
	if !exists {
		return nil, fmt.Errorf("plugin %q: %s", plugin.Manifest.ID, msgSecretRefGone)
	}
	header := strings.TrimSpace(req.Secret.Header)
	if header == "" {
		header = defaultSecretHeader
	}
	prefix := req.Secret.Prefix
	if req.Secret.Header == "" && prefix == "" {
		prefix = defaultSecretPrefix
	}
	return &fetchSecret{id: id, title: title, header: header, prefix: prefix}, nil
}

// withSecretHeader returns the request headers plus the injected one
// (a plugin-supplied header of the same name is replaced, never
// merged: the secret is the credential, whatever the plugin typed).
func withSecretHeader(headers map[string]string, sec *fetchSecret, value string) map[string]string {
	out := make(map[string]string, len(headers)+1)
	for k, v := range headers {
		if !strings.EqualFold(k, sec.header) {
			out[k] = v
		}
	}
	out[sec.header] = sec.prefix + value
	return out
}

// redactSecret scrubs the value from a response before it returns to
// plugin code -- body and every header value (an echo endpoint, a
// redirect carrying the token in a Location, a debug header).
func redactSecret(out *PluginFetchResult, value string) {
	if value == "" {
		return
	}
	out.Body = secret.Redact([]string{value}, out.Body)
	for k, v := range out.Headers {
		out.Headers[k] = secret.Redact([]string{value}, v)
	}
}
