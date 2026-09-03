package pluginsvc

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/services/guardrailsvc"
)

type fakeTrust struct{ allowed, disabled map[string]bool }

func (f fakeTrust) Enabled(id string) bool { return !f.disabled[id] }
func (f fakeTrust) Allowed(id string) bool { return f.allowed[id] }
func (f fakeTrust) Allowlist() []string    { return []string{"mill-a"} }

// The export lists every installed plugin with its declared reach and
// trust state, the plugin-actor secret reads, and states the guarded-
// action window it covers.
func TestExportPluginAudit_ListsReachTrustAndSecretReads(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "mill-a", `{"id":"mill-a","name":"A","version":"1.0.0","capabilities":["fetch"],"contributes":{"canvasObjects":[{"kind":"a","pastesURLs":true,"fileExtensions":[".a"]}],"network":[{"host":"example.com"}]}}`, nil)
	writePlugin(t, root, "mill-b", `{"id":"mill-b","name":"B","version":"2.0.0"}`, nil)
	p := New(root, nil, "0.9.0")
	p.WireAudit(fakeTrust{allowed: map[string]bool{"mill-a": true}, disabled: map[string]bool{"mill-b": true}}, func(prefix string) ([]PluginSecretAccess, error) {
		if prefix != "plugin:" {
			t.Fatalf("secret access prefix = %q, want plugin:", prefix)
		}
		return []PluginSecretAccess{{Timestamp: "2026-09-03T10:00:00Z", Label: "PAT", Actor: "plugin:mill-a", Outcome: "read"}}, nil
	})
	raw, err := p.ExportPluginAudit()
	if err != nil {
		t.Fatalf("ExportPluginAudit: %v", err)
	}
	var doc PluginAuditExport
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		t.Fatalf("export is not JSON: %v", err)
	}
	if doc.Schema != pluginAuditSchema || doc.MillVersion != "0.9.0" || doc.ActionsWindow == "" {
		t.Fatalf("header = %+v", doc)
	}
	if len(doc.Allowlist) != 1 || doc.Allowlist[0] != "mill-a" {
		t.Fatalf("allowlist = %v", doc.Allowlist)
	}
	rows := map[string]PluginAuditPlugin{}
	for _, r := range doc.Plugins {
		rows[r.ID] = r
	}
	a := rows["mill-a"]
	if !a.Allowed || !a.Enabled || !a.ClaimsLinks || len(a.ClaimsFiles) != 1 || len(a.Hosts) != 1 || a.Hosts[0] != "example.com" || len(a.Capabilities) != 1 {
		t.Fatalf("mill-a row = %+v", a)
	}
	b := rows["mill-b"]
	if b.Allowed || b.Enabled || b.Hosts == nil || b.ClaimsFiles == nil || b.Capabilities == nil {
		t.Fatalf("mill-b row = %+v (unallowed, disabled, empty-not-null lists)", b)
	}
	if drawing, ok := rows["mill-drawing"]; !ok || !drawing.Builtin || !drawing.Allowed {
		t.Fatalf("built-in row = %+v, want builtin and always allowed", drawing)
	}
	if len(doc.SecretAccess) != 1 || doc.SecretAccess[0].Actor != "plugin:mill-a" {
		t.Fatalf("secret access = %+v", doc.SecretAccess)
	}
	if doc.GuardedActions == nil {
		t.Fatal("guardedActions must be an empty array, not null, with no guardrail wired")
	}
}

// Only records a plugin asked for (Source plugin:<id>) reach the
// export, oldest first, with the plugin id split out.
func TestPluginGuardedActions_FiltersToPluginSourcesOldestFirst(t *testing.T) {
	t0 := time.Date(2026, 9, 3, 9, 0, 0, 0, time.UTC)
	recs := []guardrailsvc.GuardedActionRecord{
		{ID: "3", Source: "plugin:mill-b", Kind: "fetch", CreatedAt: t0.Add(2 * time.Hour), Status: guardrailsvc.GuardedActionApproved},
		{ID: "x", Source: "agent:claude", Kind: "fetch", CreatedAt: t0},
		{ID: "1", Source: "plugin:mill-a", Kind: "open-url", CreatedAt: t0, Status: guardrailsvc.GuardedActionDenied},
		{ID: "y", Source: "", Kind: "shell", CreatedAt: t0},
		{ID: "2", Source: "plugin:mill-a", Kind: "open-url", CreatedAt: t0.Add(time.Hour), Status: guardrailsvc.GuardedActionPending},
	}
	got := pluginGuardedActions(recs)
	if len(got) != 3 || got[0].ID != "1" || got[1].ID != "2" || got[2].ID != "3" {
		t.Fatalf("got %+v, want ids 1,2,3 oldest first", got)
	}
	if got[0].PluginID != "mill-a" || got[2].PluginID != "mill-b" || got[0].Status != "denied" {
		t.Fatalf("rows = %+v", got)
	}
}
