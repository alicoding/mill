package configuresvc

import (
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/mcpclient"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/mcpserver"
	"github.com/alicoding/mill/internal/services/seeding"
)

// mcpServersKey mirrors requestsKey/listsKey's shape (configureservice.go):
// one atomic JSON blob, same settings.json file. In its own file (not
// appended to configureservice.go) to keep that file under CLAUDE.md's
// 500-line convention -- confirmed it was already close before this was
// added.
const mcpServersKey = "configure-mcpservers"

// resolveMCPServer implements composition.go's lookupMCPServerFn seam.
// Unexported, so Wails never binds it as a callable frontend method --
// Go-internal wiring only, same as resolveHTTPRequest/resolveList.
func (c *ConfigureService) resolveMCPServer(id string) (composition.ResolvedMCPServer, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, s := range c.mcpServers {
		if s.ID == id {
			return composition.ResolvedMCPServer{Command: s.Command, Args: s.Args}, nil
		}
	}
	return composition.ResolvedMCPServer{}, fmt.Errorf("no MCP server with id %q", id)
}

// --- MCP Servers ---

func (c *ConfigureService) MCPServers() []mcpserver.MCPServer {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]mcpserver.MCPServer, len(c.mcpServers))
	copy(out, c.mcpServers)
	return out
}

func (c *ConfigureService) CreateMCPServer(label, command string, args []string) (mcpserver.MCPServer, error) {
	s := mcpserver.MCPServer{ID: seeding.NewSlugID(label, "mcp-server"), Label: label, Command: command, Args: args}
	if err := mcpserver.Validate(s); err != nil {
		return mcpserver.MCPServer{}, err
	}

	c.mu.Lock()
	c.mcpServers = append(c.mcpServers, s)
	c.mu.Unlock()

	c.persistMCPServers()
	return s, nil
}

func (c *ConfigureService) UpdateMCPServer(id, label, command string, args []string) (mcpserver.MCPServer, error) {
	s := mcpserver.MCPServer{ID: id, Label: label, Command: command, Args: args}
	if err := mcpserver.Validate(s); err != nil {
		return mcpserver.MCPServer{}, err
	}

	c.mu.Lock()
	idx := -1
	for i, existing := range c.mcpServers {
		if existing.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return mcpserver.MCPServer{}, fmt.Errorf("no MCP server with id %q", id)
	}
	c.mcpServers[idx] = s
	c.mu.Unlock()

	c.persistMCPServers()
	return s, nil
}

func (c *ConfigureService) DeleteMCPServer(id string) error {
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
		return fmt.Errorf("no MCP server with id %q", id)
	}
	wasBuiltIn := c.mcpServers[idx].BuiltIn
	c.mcpServers = append(c.mcpServers[:idx], c.mcpServers[idx+1:]...)
	c.mu.Unlock()

	// A deleted built-in gets a tombstone so top-up seeding never
	// resurrects it (topUpBuiltInMCPServers, configureservice_builtin.go)
	// -- same discipline DeleteHTTPRequest/DeleteDecision/DeleteList
	// already apply.
	if wasBuiltIn {
		seeding.RecordTombstone(c.store, id)
	}
	c.persistMCPServers()
	return nil
}

// ListMCPServerTools is a live, on-demand reference lookup (connects to
// the server, lists its tools, disconnects) -- not persisted or synced,
// same "occasional reference lookup, not a live feed" shape HTTPRequests()/
// Lists() themselves already have (the frontend polls them on demand,
// nothing pushes). This is docs/SPEC.md §3.6's actual discoverability
// answer: a user finds the exact toolName to paste into an mcp-tool-call
// node here, not by guessing.
func (c *ConfigureService) ListMCPServerTools(id string) ([]mcpclient.Tool, error) {
	rs, err := c.resolveMCPServer(id)
	if err != nil {
		return nil, err
	}
	return mcpclient.ListTools(rs.Command, rs.Args)
}

// --- persistence ---

func (c *ConfigureService) persistMCPServers() {
	c.mu.Lock()
	mcpServers := make([]mcpserver.MCPServer, len(c.mcpServers))
	copy(mcpServers, c.mcpServers)
	c.mu.Unlock()

	data, err := json.Marshal(mcpServers)
	if err != nil {
		return
	}
	_ = c.store.Set(mcpServersKey, string(data))
}

func (c *ConfigureService) restoreMCPServers() {
	raw, ok := c.store.Get(mcpServersKey).(string)
	if !ok || raw == "" {
		return
	}
	var mcpServers []mcpserver.MCPServer
	if err := json.Unmarshal([]byte(raw), &mcpServers); err != nil {
		return
	}
	c.mu.Lock()
	c.mcpServers = mcpServers
	c.mu.Unlock()
}
