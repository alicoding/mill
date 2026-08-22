package configuresvc

import (
	"fmt"
	"time"

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

func findGoldenList(id string) (list.List, bool) {
	for _, g := range list.BuiltIn() {
		if g.ID == id {
			return g, true
		}
	}
	return list.List{}, false
}

// ResetListToSeed mirrors ResetHTTPRequestToSeed for Lists -- also
// replaces Rows wholesale (upgradeListToGolden's own doc comment).
func (c *ConfigureService) ResetListToSeed(id string) (list.List, error) {
	golden, ok := findGoldenList(id)
	if !ok {
		return list.List{}, fmt.Errorf("no built-in list with id %q", id)
	}
	c.mu.Lock()
	idx := c.findListLocked(id)
	if idx == -1 {
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("no list with id %q", id)
	}
	previous := c.lists[idx]
	updated := upgradeListToGolden(previous, golden, time.Now())
	c.lists[idx] = updated
	c.mu.Unlock()

	if err := c.persistLists(); err != nil {
		c.mu.Lock()
		c.revertListLocked(previous)
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("save reset list: %w", err)
	}
	dataevent.Emit("list", id) // goal 0017: live-sync every open surface
	return updated, nil
}

// RestorableLists mirrors RestorableHTTPRequests for Lists.
func (c *ConfigureService) RestorableLists() []list.List {
	tombstones := seeding.LoadTombstones(c.store)
	if len(tombstones) == 0 {
		return nil
	}
	c.mu.Lock()
	have := make(map[string]bool, len(c.lists))
	for _, l := range c.lists {
		have[l.ID] = true
	}
	c.mu.Unlock()
	var out []list.List
	for _, golden := range list.BuiltIn() {
		if tombstones[golden.ID] && !have[golden.ID] {
			out = append(out, golden)
		}
	}
	return out
}

// RestoreList mirrors RestoreHTTPRequest for Lists.
func (c *ConfigureService) RestoreList(id string) (list.List, error) {
	golden, ok := findGoldenList(id)
	if !ok {
		return list.List{}, fmt.Errorf("no built-in list with id %q", id)
	}
	c.mu.Lock()
	if c.findListLocked(id) != -1 {
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("list %q is already present, nothing to restore", id)
	}
	c.mu.Unlock()

	if err := seeding.ClearTombstone(c.store, id); err != nil {
		return list.List{}, fmt.Errorf("clear tombstone for %q: %w", id, err)
	}
	now := time.Now()
	golden.CreatedAt, golden.UpdatedAt = now, now

	c.mu.Lock()
	c.lists = append(c.lists, golden)
	c.mu.Unlock()

	if err := c.persistLists(); err != nil {
		c.mu.Lock()
		c.removeListByIDLocked(id)
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("save restored list: %w", err)
	}
	dataevent.Emit("list", id) // goal 0017: live-sync every open surface
	return golden, nil
}

func findGoldenMCPServer(id string) (mcpserver.MCPServer, bool) {
	for _, g := range mcpserver.BuiltIn() {
		if g.ID == id {
			return g, true
		}
	}
	return mcpserver.MCPServer{}, false
}

// ResetMCPServerToSeed mirrors ResetHTTPRequestToSeed for MCP Servers.
func (c *ConfigureService) ResetMCPServerToSeed(id string) (mcpserver.MCPServer, error) {
	golden, ok := findGoldenMCPServer(id)
	if !ok {
		return mcpserver.MCPServer{}, fmt.Errorf("no built-in MCP server with id %q", id)
	}
	c.mu.Lock()
	idx := -1
	for i, s := range c.mcpServers {
		if s.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return mcpserver.MCPServer{}, fmt.Errorf("no MCP server with id %q", id)
	}
	previous := c.mcpServers[idx]
	updated := upgradeMCPServerToGolden(previous, golden, time.Now())
	c.mcpServers[idx] = updated
	c.mu.Unlock()

	if err := c.persistMCPServers(); err != nil {
		c.mu.Lock()
		c.mcpServers[idx] = previous
		c.mu.Unlock()
		return mcpserver.MCPServer{}, fmt.Errorf("save reset MCP server: %w", err)
	}
	dataevent.Emit("mcpserver", id) // goal 0017: live-sync every open surface
	return updated, nil
}

// RestorableMCPServers mirrors RestorableHTTPRequests for MCP Servers.
func (c *ConfigureService) RestorableMCPServers() []mcpserver.MCPServer {
	tombstones := seeding.LoadTombstones(c.store)
	if len(tombstones) == 0 {
		return nil
	}
	c.mu.Lock()
	have := make(map[string]bool, len(c.mcpServers))
	for _, s := range c.mcpServers {
		have[s.ID] = true
	}
	c.mu.Unlock()
	var out []mcpserver.MCPServer
	for _, golden := range mcpserver.BuiltIn() {
		if tombstones[golden.ID] && !have[golden.ID] {
			out = append(out, golden)
		}
	}
	return out
}

// RestoreMCPServer mirrors RestoreHTTPRequest for MCP Servers.
func (c *ConfigureService) RestoreMCPServer(id string) (mcpserver.MCPServer, error) {
	golden, ok := findGoldenMCPServer(id)
	if !ok {
		return mcpserver.MCPServer{}, fmt.Errorf("no built-in MCP server with id %q", id)
	}
	c.mu.Lock()
	for _, existing := range c.mcpServers {
		if existing.ID == id {
			c.mu.Unlock()
			return mcpserver.MCPServer{}, fmt.Errorf("MCP server %q is already present, nothing to restore", id)
		}
	}
	c.mu.Unlock()

	if err := seeding.ClearTombstone(c.store, id); err != nil {
		return mcpserver.MCPServer{}, fmt.Errorf("clear tombstone for %q: %w", id, err)
	}
	now := time.Now()
	golden.CreatedAt, golden.UpdatedAt = now, now

	c.mu.Lock()
	c.mcpServers = append(c.mcpServers, golden)
	c.mu.Unlock()

	if err := c.persistMCPServers(); err != nil {
		c.mu.Lock()
		for i, s := range c.mcpServers {
			if s.ID == id {
				c.mcpServers = append(c.mcpServers[:i], c.mcpServers[i+1:]...)
				break
			}
		}
		c.mu.Unlock()
		return mcpserver.MCPServer{}, fmt.Errorf("save restored MCP server: %w", err)
	}
	dataevent.Emit("mcpserver", id) // goal 0017: live-sync every open surface
	return golden, nil
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

func findGoldenAIProvider(id string) (aiprovider.AIProvider, bool) {
	for _, g := range aiprovider.BuiltIn() {
		if g.ID == id {
			return g, true
		}
	}
	return aiprovider.AIProvider{}, false
}

// ResetAIProviderToSeed mirrors ResetMCPServerToSeed for AI providers.
func (c *ConfigureService) ResetAIProviderToSeed(id string) (aiprovider.AIProvider, error) {
	golden, ok := findGoldenAIProvider(id)
	if !ok {
		return aiprovider.AIProvider{}, fmt.Errorf("no built-in AI provider with id %q", id)
	}
	c.mu.Lock()
	idx := -1
	for i, p := range c.aiProviders {
		if p.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return aiprovider.AIProvider{}, fmt.Errorf("no AI provider with id %q", id)
	}
	previous := c.aiProviders[idx]
	updated := upgradeAIProviderToGolden(previous, golden, time.Now())
	c.aiProviders[idx] = updated
	c.mu.Unlock()

	if err := c.persistAIProviders(); err != nil {
		c.mu.Lock()
		c.aiProviders[idx] = previous
		c.mu.Unlock()
		return aiprovider.AIProvider{}, fmt.Errorf("save reset AI provider: %w", err)
	}
	dataevent.Emit("aiprovider", id) // goal 0017: live-sync every open surface
	return updated, nil
}

// RestorableAIProviders mirrors RestorableMCPServers for AI providers.
func (c *ConfigureService) RestorableAIProviders() []aiprovider.AIProvider {
	tombstones := seeding.LoadTombstones(c.store)
	if len(tombstones) == 0 {
		return nil
	}
	c.mu.Lock()
	have := make(map[string]bool, len(c.aiProviders))
	for _, p := range c.aiProviders {
		have[p.ID] = true
	}
	c.mu.Unlock()
	var out []aiprovider.AIProvider
	for _, golden := range aiprovider.BuiltIn() {
		if tombstones[golden.ID] && !have[golden.ID] {
			out = append(out, golden)
		}
	}
	return out
}

// RestoreAIProvider mirrors RestoreMCPServer for AI providers.
func (c *ConfigureService) RestoreAIProvider(id string) (aiprovider.AIProvider, error) {
	golden, ok := findGoldenAIProvider(id)
	if !ok {
		return aiprovider.AIProvider{}, fmt.Errorf("no built-in AI provider with id %q", id)
	}
	c.mu.Lock()
	for _, existing := range c.aiProviders {
		if existing.ID == id {
			c.mu.Unlock()
			return aiprovider.AIProvider{}, fmt.Errorf("AI provider %q is already present, nothing to restore", id)
		}
	}
	c.mu.Unlock()

	if err := seeding.ClearTombstone(c.store, id); err != nil {
		return aiprovider.AIProvider{}, fmt.Errorf("clear tombstone for %q: %w", id, err)
	}
	now := time.Now()
	golden.CreatedAt, golden.UpdatedAt = now, now

	c.mu.Lock()
	c.aiProviders = append(c.aiProviders, golden)
	c.mu.Unlock()

	if err := c.persistAIProviders(); err != nil {
		c.mu.Lock()
		for i, p := range c.aiProviders {
			if p.ID == id {
				c.aiProviders = append(c.aiProviders[:i], c.aiProviders[i+1:]...)
				break
			}
		}
		c.mu.Unlock()
		return aiprovider.AIProvider{}, fmt.Errorf("save restored AI provider: %w", err)
	}
	dataevent.Emit("aiprovider", id) // goal 0017: live-sync every open surface
	return golden, nil
}
