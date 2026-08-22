package configuresvc

import (
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/execenv"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/mcpserver"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/entitystore"
	"github.com/alicoding/mill/internal/services/seeding"
)

// Reset-to-shipped-example + restore-deleted-example RPCs
// (docs/goals/0037 items 4/5) for List/MCPServer/ExecEnv -- the other
// half of configureservice_seedlifecycle.go, split purely to stay
// under the 500-line convention.

// findGoldenList returns a copy of the golden List with id, if one
// exists among list.BuiltIn().
func findGoldenList(id string) (list.List, bool) {
	for _, g := range list.BuiltIn() {
		if g.ID == id {
			return g, true
		}
	}
	return list.List{}, false
}

// ResetListToSeed mirrors ResetHTTPRequestToSeed for Lists -- also
// replaces Rows wholesale (upgradeListToGolden's own doc comment), via
// listDescriptor (configurelist.go, goal 0165).
func (c *ConfigureService) ResetListToSeed(id string) (list.List, error) {
	updated, err := entitystore.ResetToSeed(&c.mu, &c.lists, c.persistLists, listDescriptor, id)
	if err != nil {
		return list.List{}, err
	}
	dataevent.Emit("list", id) // goal 0017: live-sync every open surface
	return updated, nil
}

// RestorableLists mirrors RestorableHTTPRequests for Lists.
func (c *ConfigureService) RestorableLists() []list.List {
	return entitystore.Restorable(&c.mu, &c.lists, seeding.LoadTombstones(c.store), listDescriptor)
}

// RestoreList mirrors RestoreHTTPRequest for Lists.
func (c *ConfigureService) RestoreList(id string) (list.List, error) {
	restored, err := entitystore.Restore(&c.mu, &c.lists, c.persistLists, c.store, listDescriptor, id)
	if err != nil {
		return list.List{}, err
	}
	dataevent.Emit("list", id) // goal 0017: live-sync every open surface
	return restored, nil
}

// ResetMCPServerToSeed mirrors ResetHTTPRequestToSeed for MCP Servers,
// via mcpServerDescriptor (configuremcpserver.go, goal 0165).
func (c *ConfigureService) ResetMCPServerToSeed(id string) (mcpserver.MCPServer, error) {
	updated, err := entitystore.ResetToSeed(&c.mu, &c.mcpServers, c.persistMCPServers, mcpServerDescriptor, id)
	if err != nil {
		return mcpserver.MCPServer{}, err
	}
	dataevent.Emit("mcpserver", id) // goal 0017: live-sync every open surface
	return updated, nil
}

// RestorableMCPServers mirrors RestorableHTTPRequests for MCP Servers.
func (c *ConfigureService) RestorableMCPServers() []mcpserver.MCPServer {
	return entitystore.Restorable(&c.mu, &c.mcpServers, seeding.LoadTombstones(c.store), mcpServerDescriptor)
}

// RestoreMCPServer mirrors RestoreHTTPRequest for MCP Servers.
func (c *ConfigureService) RestoreMCPServer(id string) (mcpserver.MCPServer, error) {
	restored, err := entitystore.Restore(&c.mu, &c.mcpServers, c.persistMCPServers, c.store, mcpServerDescriptor, id)
	if err != nil {
		return mcpserver.MCPServer{}, err
	}
	dataevent.Emit("mcpserver", id) // goal 0017: live-sync every open surface
	return restored, nil
}

// ResetExecEnvToSeed mirrors ResetHTTPRequestToSeed for ExecEnvs, via
// execEnvDescriptor (configureexecenv.go, goal 0165).
func (c *ConfigureService) ResetExecEnvToSeed(id string) (execenv.ExecEnv, error) {
	updated, err := entitystore.ResetToSeed(&c.mu, &c.execEnvs, c.persistExecEnvs, execEnvDescriptor, id)
	if err != nil {
		return execenv.ExecEnv{}, err
	}
	dataevent.Emit("execenv", id) // goal 0017: live-sync every open surface
	return updated, nil
}

// RestorableExecEnvs mirrors RestorableHTTPRequests for ExecEnvs.
func (c *ConfigureService) RestorableExecEnvs() []execenv.ExecEnv {
	return entitystore.Restorable(&c.mu, &c.execEnvs, seeding.LoadTombstones(c.store), execEnvDescriptor)
}

// RestoreExecEnv mirrors RestoreHTTPRequest for ExecEnvs.
func (c *ConfigureService) RestoreExecEnv(id string) (execenv.ExecEnv, error) {
	restored, err := entitystore.Restore(&c.mu, &c.execEnvs, c.persistExecEnvs, c.store, execEnvDescriptor, id)
	if err != nil {
		return execenv.ExecEnv{}, err
	}
	dataevent.Emit("execenv", id) // goal 0017: live-sync every open surface
	return restored, nil
}

// ResetAIProviderToSeed mirrors ResetMCPServerToSeed for AI providers,
// via aiProviderDescriptor (configureaiprovider.go, goal 0165).
func (c *ConfigureService) ResetAIProviderToSeed(id string) (aiprovider.AIProvider, error) {
	updated, err := entitystore.ResetToSeed(&c.mu, &c.aiProviders, c.persistAIProviders, aiProviderDescriptor, id)
	if err != nil {
		return aiprovider.AIProvider{}, err
	}
	dataevent.Emit("aiprovider", id) // goal 0017: live-sync every open surface
	return updated, nil
}

// RestorableAIProviders mirrors RestorableMCPServers for AI providers.
func (c *ConfigureService) RestorableAIProviders() []aiprovider.AIProvider {
	return entitystore.Restorable(&c.mu, &c.aiProviders, seeding.LoadTombstones(c.store), aiProviderDescriptor)
}

// RestoreAIProvider mirrors RestoreMCPServer for AI providers.
func (c *ConfigureService) RestoreAIProvider(id string) (aiprovider.AIProvider, error) {
	restored, err := entitystore.Restore(&c.mu, &c.aiProviders, c.persistAIProviders, c.store, aiProviderDescriptor, id)
	if err != nil {
		return aiprovider.AIProvider{}, err
	}
	dataevent.Emit("aiprovider", id) // goal 0017: live-sync every open surface
	return restored, nil
}
