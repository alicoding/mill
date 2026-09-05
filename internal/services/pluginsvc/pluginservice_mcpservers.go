package pluginsvc

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// The manifest's contributes.mcpServers family (docs/goals/0349 S5,
// docs/adr/0047): a plugin can SHIP an MCP server definition -- the
// command that starts it and the environment it needs -- so a person
// adds it to Configure in one click instead of retyping it. The plugin
// never runs the server and never sees a secret: Mill creates the
// Configure entity through its own create door, and every secret the
// server needs travels as a reference that Configure resolves at
// spawn, the same "vault:<id>" grammar an MCP Server entity already
// holds in its Env.
//
// A manifest names a secret ONLY through one of its own secretRef
// settings ("secretRef:<setting key>"): the user picks the entry in
// the extension's Settings tab, and the reference is read from that
// pick when the entity is created. A literal that looks like a
// credential is refused at load, so a plugin cannot ship a token.

// MCPServerContribution declares one MCP server a plugin ships. Env
// maps a variable name to a literal value or to "secretRef:<setting>"
// naming one of this plugin's own secretRef settings.
type MCPServerContribution struct {
	ID      string            `json:"id"`
	Label   string            `json:"label"`
	Command string            `json:"command"`
	Args    []string          `json:"args"`
	Env     map[string]string `json:"env"`
}

// secretRefEnvPrefix marks an env value that names a secretRef setting
// rather than carrying a literal.
const secretRefEnvPrefix = "secretRef:"

// envKeyPattern is the shell's own variable-name shape.
var envKeyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// secretShapedKeyPattern flags a variable name that conventionally
// carries a credential. A literal under such a name is refused: it
// would ship a secret inside a plugin folder.
var secretShapedKeyPattern = regexp.MustCompile(`(?i)(TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CREDENTIAL)`)

// validateMCPServers fail-closes the family the same way every other
// contribution does: a malformed server blocks the load with a reason
// the author can act on.
func validateMCPServers(settings []SettingContribution, servers []MCPServerContribution) string {
	secretSettings := map[string]bool{}
	for _, st := range settings {
		if st.Type == SettingTypeSecretRef {
			secretSettings[st.Key] = true
		}
	}
	seen := map[string]bool{}
	for _, s := range servers {
		if problem := validateOneMCPServer(s, secretSettings, seen); problem != "" {
			return problem
		}
		seen[s.ID] = true
	}
	return ""
}

func validateOneMCPServer(s MCPServerContribution, secretSettings, seen map[string]bool) string {
	if !pluginIDPattern.MatchString(s.ID) {
		return fmt.Sprintf("contributed MCP server id %q must be lowercase letters, digits, and hyphens", s.ID)
	}
	if seen[s.ID] {
		return fmt.Sprintf("contributed MCP server %q is declared twice", s.ID)
	}
	if strings.TrimSpace(s.Label) == "" {
		return fmt.Sprintf("contributed MCP server %q needs a label", s.ID)
	}
	if strings.TrimSpace(s.Command) == "" {
		return fmt.Sprintf("contributed MCP server %q needs a command", s.ID)
	}
	for key, value := range s.Env {
		if problem := validateMCPServerEnv(s.ID, key, value, secretSettings); problem != "" {
			return problem
		}
	}
	return ""
}

func validateMCPServerEnv(serverID, key, value string, secretSettings map[string]bool) string {
	if !envKeyPattern.MatchString(key) {
		return fmt.Sprintf("contributed MCP server %q env %q must be a variable name", serverID, key)
	}
	if strings.HasPrefix(value, secretRefEnvPrefix) {
		setting := strings.TrimPrefix(value, secretRefEnvPrefix)
		if !secretSettings[setting] {
			return fmt.Sprintf("contributed MCP server %q env %q names setting %q, which is not a declared secretRef setting", serverID, key, setting)
		}
		return ""
	}
	if _, _, isRef := strings.Cut(value, ":"); isRef && strings.HasPrefix(value, "vault:") {
		return fmt.Sprintf("contributed MCP server %q env %q must name a secretRef setting, not a vault entry", serverID, key)
	}
	if secretShapedKeyPattern.MatchString(key) {
		return fmt.Sprintf("contributed MCP server %q env %q looks like a secret; use \"secretRef:<setting>\" instead of a literal", serverID, key)
	}
	return ""
}

// conformMCPServers is standard rule 23: the same checks the loader
// applies, named by rule so an author finds it on the standard page.
func conformMCPServers(m Manifest) []string {
	if problem := validateMCPServers(m.Contributes.Settings, m.Contributes.MCPServers); problem != "" {
		return []string{"standard rule 23: " + problem}
	}
	return nil
}

// MCPServerConfig is what "Add to Configure" hands the Configure
// create door: the entity's label, command, args and KEY=VALUE env,
// with every secret already a reference and never a value.
type MCPServerConfig struct {
	Label   string
	Command string
	Args    []string
	Env     []string
}

// ResolveMCPServer answers one declared server as a Configure entity's
// fields. A secretRef env entry reads the setting the user picked in
// the extension's Settings tab; an unpicked one refuses, naming the
// setting, rather than creating an entity that would fail at spawn.
func (p *PluginService) ResolveMCPServer(pluginID, serverID string) (MCPServerConfig, error) {
	info := p.resolvePlugin(pluginID)
	if info.Error != "" {
		return MCPServerConfig{}, fmt.Errorf("%s", info.Error)
	}
	server, ok := findMCPServer(info.Manifest.Contributes.MCPServers, serverID)
	if !ok {
		return MCPServerConfig{}, fmt.Errorf("%q declares no MCP server %q", info.Manifest.Name, serverID)
	}
	env, err := p.mcpServerEnv(info.Manifest, server)
	if err != nil {
		return MCPServerConfig{}, err
	}
	return MCPServerConfig{Label: server.Label, Command: server.Command, Args: append([]string{}, server.Args...), Env: env}, nil
}

func findMCPServer(servers []MCPServerContribution, id string) (MCPServerContribution, bool) {
	for _, s := range servers {
		if s.ID == id {
			return s, true
		}
	}
	return MCPServerContribution{}, false
}

// mcpServerEnv renders the env list in key order, so the created
// entity reads the same way every time.
func (p *PluginService) mcpServerEnv(m Manifest, server MCPServerContribution) ([]string, error) {
	keys := make([]string, 0, len(server.Env))
	for key := range server.Env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	env := make([]string, 0, len(keys))
	for _, key := range keys {
		value := server.Env[key]
		if strings.HasPrefix(value, secretRefEnvPrefix) {
			ref, err := p.pickedSecretReference(m, strings.TrimPrefix(value, secretRefEnvPrefix))
			if err != nil {
				return nil, err
			}
			value = ref
		}
		env = append(env, key+"="+value)
	}
	return env, nil
}

// pickedSecretReference reads the entry the user picked for one
// secretRef setting and answers it as a reference. A bare vault id
// becomes "vault:<id>"; a provider-qualified id is already a reference.
func (p *PluginService) pickedSecretReference(m Manifest, settingKey string) (string, error) {
	label := settingKey
	for _, st := range m.Contributes.Settings {
		if st.Key == settingKey && strings.TrimSpace(st.Label) != "" {
			label = st.Label
		}
	}
	if p.readSetting == nil {
		return "", fmt.Errorf("secrets are not available to extensions in this mode")
	}
	literal, ok := p.readSetting(m.ID, settingKey)
	var id string
	if ok {
		_ = json.Unmarshal([]byte(literal), &id)
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return "", fmt.Errorf("pick a secret for %q in the extension's Settings tab first", label)
	}
	if strings.Contains(id, ":") {
		return id, nil
	}
	return "vault:" + id, nil
}
