package pluginsvc

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/services/guardrailsvc"
)

// The plugin audit export (ADR-0051 §4, slice 3): one JSON document an
// administrator can file -- every installed plugin with its declared
// reach and trust state, every guarded action a plugin asked for
// within the guardrail store's retention window, and every secret read
// a plugin made (the durable secret-access history, filtered to the
// "plugin:" actor). The export READS existing records; nothing here
// writes.

// PluginTrustReader answers the trust posture per plugin (the
// settings service, wired by the composition root).
type PluginTrustReader interface {
	Enabled(id string) bool
	Allowed(id string) bool
	Allowlist() []string
	// LockedHash is the content hash the plugin's consent covers ("" when
	// none recorded).
	LockedHash(id string) string
}

// PluginSecretAccess is one secret-read row as the export carries it.
type PluginSecretAccess struct {
	Timestamp string `json:"timestamp"`
	Label     string `json:"label"`
	Context   string `json:"context"`
	Actor     string `json:"actor"`
	Outcome   string `json:"outcome"`
	Error     string `json:"error,omitempty"`
}

// PluginAuditPlugin is one installed plugin's row in the export.
type PluginAuditPlugin struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Version      string   `json:"version"`
	Builtin      bool     `json:"builtin"`
	Capabilities []string `json:"capabilities"`
	Hosts        []string `json:"hosts"`
	ClaimsLinks  bool     `json:"claimsLinks"`
	ClaimsFiles  []string `json:"claimsFiles"`
	Enabled      bool     `json:"enabled"`
	Allowed      bool     `json:"allowed"`
	ContentHash  string   `json:"contentHash,omitempty"`
	LockedHash   string   `json:"lockedHash,omitempty"`
	Changed      bool     `json:"changed"`
	Signed       bool     `json:"signed"`
	Error        string   `json:"error,omitempty"`
}

// PluginAuditAction is one guarded action a plugin requested.
type PluginAuditAction struct {
	ID          string            `json:"id"`
	PluginID    string            `json:"pluginId"`
	Kind        string            `json:"kind"`
	Attributes  map[string]string `json:"attributes,omitempty"`
	Description string            `json:"description"`
	CreatedAt   time.Time         `json:"createdAt"`
	Status      string            `json:"status"`
	ResolvedAt  *time.Time        `json:"resolvedAt,omitempty"`
	Error       string            `json:"error,omitempty"`
}

// PluginAuditExport is the document.
type PluginAuditExport struct {
	Schema         string               `json:"schema"`
	ExportedAt     time.Time            `json:"exportedAt"`
	MillVersion    string               `json:"millVersion"`
	Allowlist      []string             `json:"allowlist"`
	SigningPolicy  bool                 `json:"signingPolicy"`
	ActionsWindow  string               `json:"guardedActionsWindow"`
	Plugins        []PluginAuditPlugin  `json:"plugins"`
	GuardedActions []PluginAuditAction  `json:"guardedActions"`
	SecretAccess   []PluginSecretAccess `json:"secretAccess"`
}

const pluginAuditSchema = "mill-plugin-audit/1"

// WireAudit installs the export's read seams (composition root).
//
//wails:ignore
func (p *PluginService) WireAudit(trust PluginTrustReader, secretAccess func(actorPrefix string) ([]PluginSecretAccess, error)) {
	p.trust = trust
	p.secretAccess = secretAccess
}

// ExportPluginAudit assembles the document and returns it as JSON text
// (the frontend saves it through the same download door every other
// export uses).
func (p *PluginService) ExportPluginAudit() (string, error) {
	infos, err := p.ListPlugins()
	if err != nil {
		return "", err
	}
	doc := PluginAuditExport{
		Schema:         pluginAuditSchema,
		ExportedAt:     time.Now(),
		MillVersion:    p.appVersion,
		Allowlist:      []string{},
		ActionsWindow:  guardrailsvc.GuardedActionRetention().String(),
		Plugins:        make([]PluginAuditPlugin, 0, len(infos)),
		GuardedActions: []PluginAuditAction{},
		SecretAccess:   []PluginSecretAccess{},
	}
	if p.trust != nil {
		doc.Allowlist = append(doc.Allowlist, p.trust.Allowlist()...)
	}
	doc.SigningPolicy = p.SigningPolicyActive()
	for _, info := range infos {
		doc.Plugins = append(doc.Plugins, p.auditRow(info))
	}
	if p.guardrail != nil {
		store := p.guardrail.PendingActionStore()
		pending, _ := store.Pending("", guardrailsvc.GuardedActionRetention())
		resolved, _ := store.Resolved("", guardrailsvc.GuardedActionRetention())
		doc.GuardedActions = pluginGuardedActions(append(pending, resolved...))
	}
	if p.secretAccess != nil {
		rows, err := p.secretAccess("plugin:")
		if err != nil {
			return "", fmt.Errorf("plugin audit: secret access: %w", err)
		}
		doc.SecretAccess = append(doc.SecretAccess, rows...)
	}
	out, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func (p *PluginService) auditRow(info PluginInfo) PluginAuditPlugin {
	m := info.Manifest
	row := PluginAuditPlugin{
		ID: m.ID, Name: m.Name, Version: m.Version, Builtin: info.Builtin,
		Capabilities: append([]string{}, m.Capabilities...),
		Hosts:        []string{},
		ClaimsFiles:  []string{},
		Error:        info.Error,
		Enabled:      true,
		Allowed:      info.Builtin,
		ContentHash:  info.ContentHash,
		Signed:       info.Signed,
	}
	for _, n := range m.Contributes.Network {
		row.Hosts = append(row.Hosts, n.Host)
	}
	for _, obj := range m.Contributes.CanvasObjects {
		row.ClaimsLinks = row.ClaimsLinks || obj.PastesURLs
		row.ClaimsFiles = append(row.ClaimsFiles, obj.FileExtensions...)
	}
	if p.trust != nil && !info.Builtin {
		row.Enabled = p.trust.Enabled(m.ID)
		row.Allowed = p.trust.Allowed(m.ID)
		row.LockedHash = p.trust.LockedHash(m.ID)
		row.Changed = row.LockedHash != "" && row.ContentHash != "" && row.LockedHash != row.ContentHash
	}
	return row
}

// pluginGuardedActions keeps the records a plugin asked for (Source
// "plugin:<id>"), oldest first, as export rows.
func pluginGuardedActions(records []guardrailsvc.GuardedActionRecord) []PluginAuditAction {
	out := []PluginAuditAction{}
	for _, rec := range records {
		pluginID, ok := strings.CutPrefix(rec.Source, "plugin:")
		if !ok {
			continue
		}
		out = append(out, PluginAuditAction{
			ID: rec.ID, PluginID: pluginID, Kind: rec.Kind, Attributes: rec.Attributes, Description: rec.Description,
			CreatedAt: rec.CreatedAt, Status: string(rec.Status), ResolvedAt: rec.ResolvedAt, Error: rec.Error,
		})
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].CreatedAt.Before(out[j-1].CreatedAt); j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}
