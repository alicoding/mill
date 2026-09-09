package pluginsvc

import "fmt"

// IntegrationExecutor resolves and performs one declared operation of
// a Configure Integration entity (composition.ExecuteOperation, goal
// 0374's non-workflow execution door) -- a plain func-type seam, the
// same SettingReader shape, since the composition root wires it
// straight to composition.ExecuteOperation with no state of its own.
type IntegrationExecutor func(requestID, path, method string, values map[string]string) (string, error)

// WireIntegrations connects the Configure Integration execution door
// (composition root, alongside WireSecretRefs).
//
//wails:ignore
func (p *PluginService) WireIntegrations(exec IntegrationExecutor) {
	p.integrations = exec
}

// CallIntegrationForPlugin performs a READ-only operation against a
// Configure Integration the plugin's own settings named (goal 0374
// item 1's rows, and the transition picker's own "allowed next
// transitions" read): never itself a guarded action -- the same
// "reading through a wire the user already authorized when they picked
// the Integration" posture a workflow's own integration-http read step
// already has. A WRITE (kind external.comment/external.transition)
// never reaches here; it crosses pluginservice_guardedwrite.go's own
// ClassExternal ask gate first.
func (p *PluginService) CallIntegrationForPlugin(pluginID, integrationID, path, method string, values map[string]string) (string, error) {
	plugin := p.resolvePlugin(pluginID)
	if plugin.Error != "" {
		return "", fmt.Errorf("plugin %q: %s", pluginID, plugin.Error)
	}
	if !hasCapability(plugin.Manifest, "call-integration") {
		return "", fmt.Errorf("plugin %q does not declare the \"call-integration\" capability in its manifest", pluginID)
	}
	if p.integrations == nil {
		return "", fmt.Errorf("plugin %q: Integrations are not available in this mode", pluginID)
	}
	return p.integrations(integrationID, path, method, values)
}
