package pluginsvc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func secretSetting(key string) SettingContribution {
	return SettingContribution{Key: key, Type: SettingTypeSecretRef, Label: "Token"}
}

func TestValidateMCPServers_Table(t *testing.T) {
	settings := []SettingContribution{secretSetting("token")}
	cases := []struct {
		name    string
		servers []MCPServerContribution
		want    string
	}{
		{"valid", []MCPServerContribution{{ID: "ref", Label: "Reference", Command: "npx", Args: []string{"-y", "x"}, Env: map[string]string{"API_TOKEN": "secretRef:token", "MODE": "plain"}}}, ""},
		{"bad id", []MCPServerContribution{{ID: "Ref!", Label: "R", Command: "npx"}}, "must be lowercase"},
		{"duplicate", []MCPServerContribution{{ID: "ref", Label: "R", Command: "npx"}, {ID: "ref", Label: "R", Command: "npx"}}, "declared twice"},
		{"no label", []MCPServerContribution{{ID: "ref", Command: "npx"}}, "needs a label"},
		{"no command", []MCPServerContribution{{ID: "ref", Label: "R", Command: " "}}, "needs a command"},
		{"bad env key", []MCPServerContribution{{ID: "ref", Label: "R", Command: "npx", Env: map[string]string{"1BAD": "x"}}}, "must be a variable name"},
		{"secret literal", []MCPServerContribution{{ID: "ref", Label: "R", Command: "npx", Env: map[string]string{"GITHUB_TOKEN": "ghp_abc"}}}, "looks like a secret"},
		{"vault literal", []MCPServerContribution{{ID: "ref", Label: "R", Command: "npx", Env: map[string]string{"MODE": "vault:entry-1"}}}, "not a vault entry"},
		{"undeclared setting", []MCPServerContribution{{ID: "ref", Label: "R", Command: "npx", Env: map[string]string{"API_TOKEN": "secretRef:missing"}}}, "not a declared secretRef setting"},
	}
	for _, c := range cases {
		got := validateMCPServers(settings, c.servers)
		if c.want == "" && got != "" {
			t.Errorf("%s: unexpected problem %q", c.name, got)
		}
		if c.want != "" && !strings.Contains(got, c.want) {
			t.Errorf("%s: problem = %q, want it to mention %q", c.name, got, c.want)
		}
	}
}

func TestConformMCPServers_NamesRule23(t *testing.T) {
	m := Manifest{Contributes: ManifestContributes{MCPServers: []MCPServerContribution{{ID: "ref", Label: "R"}}}}
	problems := conformMCPServers(m)
	if len(problems) != 1 || !strings.HasPrefix(problems[0], "standard rule 23: ") {
		t.Fatalf("problems = %v", problems)
	}
	if got := conformMCPServers(Manifest{}); len(got) != 0 {
		t.Errorf("a manifest with no servers reported %v", got)
	}
}

func writeMCPPlugin(t *testing.T, dir string) {
	t.Helper()
	plugin := filepath.Join(dir, "acme-mcp")
	if err := os.MkdirAll(plugin, 0o750); err != nil {
		t.Fatal(err)
	}
	manifest := `{"id":"acme-mcp","name":"Acme MCP","version":"1.0.0","contributes":{
		"settings":[{"key":"token","type":"secretRef","label":"Acme token"}],
		"mcpServers":[{"id":"acme","label":"Acme server","command":"npx","args":["-y","acme"],"env":{"MODE":"prod","ACME_TOKEN":"secretRef:token"}}]}}`
	for rel, body := range map[string]string{"manifest.json": manifest, "main.js": "export function activate() {}"} {
		if err := os.WriteFile(filepath.Join(plugin, rel), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

// The resolve door hands Configure a reference, never a value: a bare
// picked entry id becomes "vault:<id>", a provider-qualified pick
// passes through, and env is rendered in key order.
func TestResolveMCPServer_RendersReferencesInKeyOrder(t *testing.T) {
	dir := t.TempDir()
	writeMCPPlugin(t, dir)
	svc := New(dir, nil, "")
	svc.WireSecretRefs(nil, func(pluginID, key string) (string, bool) {
		if pluginID == "acme-mcp" && key == "token" {
			return `"entry-7"`, true
		}
		return "", false
	})
	cfg, err := svc.ResolveMCPServer("acme-mcp", "acme")
	if err != nil {
		t.Fatalf("ResolveMCPServer: %v", err)
	}
	if cfg.Label != "Acme server" || cfg.Command != "npx" || len(cfg.Args) != 2 {
		t.Errorf("config = %+v", cfg)
	}
	if strings.Join(cfg.Env, ",") != "ACME_TOKEN=vault:entry-7,MODE=prod" {
		t.Errorf("env = %v", cfg.Env)
	}

	svc.WireSecretRefs(nil, func(string, string) (string, bool) { return `"env:work/ACME"`, true })
	cfg, err = svc.ResolveMCPServer("acme-mcp", "acme")
	if err != nil || cfg.Env[0] != "ACME_TOKEN=env:work/ACME" {
		t.Errorf("provider-qualified pick = %v, %v", cfg.Env, err)
	}
}

func TestResolveMCPServer_RefusesWhenNoSecretIsPicked(t *testing.T) {
	dir := t.TempDir()
	writeMCPPlugin(t, dir)
	svc := New(dir, nil, "")
	svc.WireSecretRefs(nil, func(string, string) (string, bool) { return "", false })
	if _, err := svc.ResolveMCPServer("acme-mcp", "acme"); err == nil || !strings.Contains(err.Error(), "Acme token") {
		t.Fatalf("err = %v, want a refusal naming the setting", err)
	}
	if _, err := svc.ResolveMCPServer("acme-mcp", "other"); err == nil {
		t.Error("an undeclared server resolved")
	}
}
