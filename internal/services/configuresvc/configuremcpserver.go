package configuresvc

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/mcpclient"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/mcpserver"
	"github.com/alicoding/mill/internal/services/dataevent"
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

// mcpServerExistsLocked reports whether id names a real local
// MCPServer -- callers must hold c.mu. ImportMCPServer's own
// create-vs-update check (configureservice_export.go).
func (c *ConfigureService) mcpServerExistsLocked(id string) bool {
	for _, s := range c.mcpServers {
		if s.ID == id {
			return true
		}
	}
	return false
}

func (c *ConfigureService) CreateMCPServer(label, command string, args []string) (mcpserver.MCPServer, error) {
	return c.createMCPServerWithID(seeding.NewSlugID(label, "mcp-server"), label, command, args)
}

// createMCPServerWithID is CreateMCPServer's own logic, parameterized
// on the new server's id -- the seam ImportMCPServer uses to preserve a
// caller-supplied id (ADR-0036 decision 3).
func (c *ConfigureService) createMCPServerWithID(id, label, command string, args []string) (mcpserver.MCPServer, error) {
	now := time.Now()
	s := mcpserver.MCPServer{ID: id, Label: label, Command: command, Args: args, CreatedAt: now, UpdatedAt: now}
	if err := mcpserver.Validate(s); err != nil {
		return mcpserver.MCPServer{}, err
	}

	c.mu.Lock()
	c.mcpServers = append(c.mcpServers, s)
	c.mu.Unlock()

	if err := c.persistMCPServers(); err != nil {
		c.mu.Lock()
		for i, existing := range c.mcpServers {
			if existing.ID == s.ID {
				c.mcpServers = append(c.mcpServers[:i], c.mcpServers[i+1:]...)
				break
			}
		}
		c.mu.Unlock()
		return mcpserver.MCPServer{}, fmt.Errorf("save MCP server: %w", err)
	}
	dataevent.Emit("mcpserver", s.ID) // goal 0017: live-sync every open surface
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
	// CreatedAt is preserved from the stored entity, never trusted from
	// the wire; UpdatedAt always advances on a real update.
	s.CreatedAt = c.mcpServers[idx].CreatedAt
	s.UpdatedAt = time.Now()
	s.Seed = c.mcpServers[idx].Seed.Touch() // docs/goals/0037 item 2
	previous := c.mcpServers[idx]
	c.mcpServers[idx] = s
	c.mu.Unlock()

	if err := c.persistMCPServers(); err != nil {
		c.mu.Lock()
		for i, existing := range c.mcpServers {
			if existing.ID == id {
				c.mcpServers[i] = previous
				break
			}
		}
		c.mu.Unlock()
		return mcpserver.MCPServer{}, fmt.Errorf("save MCP server: %w", err)
	}
	dataevent.Emit("mcpserver", s.ID) // goal 0017: live-sync every open surface
	return s, nil
}

func (c *ConfigureService) DeleteMCPServer(id string) error {
	if err := c.refIntegrityError("mcpserver", "MCP server", id); err != nil {
		return err
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
		return fmt.Errorf("no MCP server with id %q", id)
	}
	removed := c.mcpServers[idx]
	wasBuiltIn := removed.BuiltIn
	c.mcpServers = append(c.mcpServers[:idx], c.mcpServers[idx+1:]...)
	c.mu.Unlock()

	// A deleted built-in gets a tombstone so top-up seeding never
	// resurrects it (topUpBuiltInMCPServers, configureservice_builtin.go)
	// -- same discipline DeleteHTTPRequest/DeleteDecision/DeleteList
	// already apply. Removal and tombstone must succeed together
	// (docs/goals/0025 item 2).
	if wasBuiltIn {
		if err := seeding.RecordTombstone(c.store, id); err != nil {
			c.mu.Lock()
			c.mcpServers = insertMCPServerAt(c.mcpServers, idx, removed)
			c.mu.Unlock()
			return fmt.Errorf("tombstone deleted MCP server %q: %w", id, err)
		}
	}
	if err := c.persistMCPServers(); err != nil {
		c.mu.Lock()
		c.mcpServers = insertMCPServerAt(c.mcpServers, idx, removed)
		c.mu.Unlock()
		return fmt.Errorf("save MCP server deletion: %w", err)
	}
	dataevent.Emit("mcpserver", id) // goal 0017: live-sync every open surface
	return nil
}

// insertMCPServerAt reinserts s at idx (clamped to the current length)
// -- used to undo DeleteMCPServer's removal when the tombstone or
// persist step that must accompany it fails.
func insertMCPServerAt(servers []mcpserver.MCPServer, idx int, s mcpserver.MCPServer) []mcpserver.MCPServer {
	if idx < 0 || idx > len(servers) {
		idx = len(servers)
	}
	servers = append(servers, mcpserver.MCPServer{})
	copy(servers[idx+1:], servers[idx:])
	servers[idx] = s
	return servers
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
	// A manual Configure-page reference lookup, not a workflow step --
	// "configure-mcpserver-preview" is a static caller identity (goal
	// 0159 slice 1's audit trail), not a per-run workflow/step id.
	return mcpclient.ListTools(rs.Command, rs.Args, "configure-mcpserver-preview")
}

// --- persistence ---

func (c *ConfigureService) persistMCPServers() error {
	c.mu.Lock()
	mcpServers := make([]mcpserver.MCPServer, len(c.mcpServers))
	copy(mcpServers, c.mcpServers)
	c.mu.Unlock()

	data, err := json.Marshal(mcpServers)
	if err != nil {
		return fmt.Errorf("marshal MCP servers: %w", err)
	}
	if err := c.store.Set(mcpServersKey, string(data)); err != nil {
		return fmt.Errorf("persist MCP servers: %w", err)
	}
	return nil
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
