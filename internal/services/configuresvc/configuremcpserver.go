package configuresvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/mcpclient"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/mcpserver"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/entitystore"
	"github.com/alicoding/mill/internal/services/seeding"
)

// mcpServerDescriptor is MCPServer's entitystore.Descriptor (goal
// 0165): the small per-kind shape Create/Update/Delete/reconcile/
// Reset/Restorable/Restore all key off, replacing what used to be
// ~10 hand-copied methods.
var mcpServerDescriptor = entitystore.Descriptor[mcpserver.MCPServer]{
	Label:     "MCP server",
	GetID:     func(s mcpserver.MCPServer) string { return s.ID },
	IsBuiltIn: func(s mcpserver.MCPServer) bool { return s.BuiltIn },
	GetSeed:   func(s mcpserver.MCPServer) seedorigin.Origin { return s.Seed },
	SetSeed:   func(s mcpserver.MCPServer, o seedorigin.Origin) mcpserver.MCPServer { s.Seed = o; return s },
	StampNew: func(s mcpserver.MCPServer, now time.Time) mcpserver.MCPServer {
		s.CreatedAt, s.UpdatedAt = now, now
		return s
	},
	Upgrade: upgradeMCPServerToGolden,
	BuiltIn: mcpserver.BuiltIn,
}

// upgradeMCPServerToGolden replaces existing's content with golden's,
// preserving existing's identity (ID/CreatedAt) -- shared by
// reconcileBuiltInMCPServers' upgrade branch and ResetMCPServerToSeed
// via mcpServerDescriptor.Upgrade.
func upgradeMCPServerToGolden(existing, golden mcpserver.MCPServer, now time.Time) mcpserver.MCPServer {
	golden.CreatedAt = existing.CreatedAt
	golden.UpdatedAt = now
	golden.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
	return golden
}

// mcpServersKey mirrors requestsKey/listsKey's shape (configureservice.go):
// one atomic JSON blob, same settings.json file. In its own file (not
// appended to configureservice.go) to keep that file under CLAUDE.md's
// 500-line convention -- confirmed it was already close before this was
// added.
const mcpServersKey = "configure-mcpservers"

// resolveMCPServer implements composition.go's lookupMCPServerFn seam --
// a real workflow run's own resolution, always tagged
// secretaudit.ContextMCPServerSpawn (goal 0203 S3). Unexported, so Wails
// never binds it as a callable frontend method -- Go-internal wiring
// only, same as resolveHTTPRequest/resolveList.
func (c *ConfigureService) resolveMCPServer(id string, run composition.SecretAccessRun) (composition.ResolvedMCPServer, error) {
	return c.resolveMCPServerWithAccess(id, secretaudit.AccessContext{
		Context: secretaudit.ContextMCPServerSpawn, RunID: run.RunID, WorkflowID: run.WorkflowID,
	})
}

// resolveMCPServerWithAccess is resolveMCPServer's own logic,
// parameterized on the caller's secretaudit.AccessContext -- the seam
// ListMCPServerTools uses to resolve the SAME server's env for its own
// preview purpose, tagged ContextConfigureToolsPreview instead of
// ContextMCPServerSpawn (goal 0203 S3, closing S2's own found gap: this
// preview spawns the real server outside any workflow run).
func (c *ConfigureService) resolveMCPServerWithAccess(id string, actx secretaudit.AccessContext) (composition.ResolvedMCPServer, error) {
	c.mu.Lock()
	var found *mcpserver.MCPServer
	for i := range c.mcpServers {
		if c.mcpServers[i].ID == id {
			found = &c.mcpServers[i]
			break
		}
	}
	c.mu.Unlock()
	if found == nil {
		return composition.ResolvedMCPServer{}, fmt.Errorf("no MCP server with id %q", id)
	}

	env, err := c.resolveMCPServerEnv(found.Label, found.Env, actx)
	if err != nil {
		return composition.ResolvedMCPServer{}, err
	}
	return composition.ResolvedMCPServer{Command: found.Command, Args: found.Args, Env: env}, nil
}

// resolveMCPServerEnv substitutes every "vault:<id>" value with that
// vault entry's real password -- vaultref.go's resolveVaultRefEnv, the
// shared resolution path every Configure entity's own KEY=VALUE Env
// field goes through (goal 0203 S1 lifted this out of an MCP-only
// helper). A locked vault surfaces here as this call's own error
// (secretsvc.ErrLocked wrapped), the explicit "vault is locked" failure
// the goal file requires, never a silent empty/wrong secret.
func (c *ConfigureService) resolveMCPServerEnv(label string, env []string, actx secretaudit.AccessContext) ([]string, error) {
	return c.resolveVaultRefEnv("MCP server", label, env, actx)
}

// --- MCP Servers ---

// MCPServerFields exposes MCPServer's declared scalar shape
// (docs/adr/0029) to the frontend's generic entity-field renderer
// (frontend/src/configure/EntityConfigFields.tsx) -- see
// AIProviderFields' identical doc comment.
func (c *ConfigureService) MCPServerFields() []typedfield.Field {
	return mcpserver.Fields
}

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

func (c *ConfigureService) CreateMCPServer(label, command string, args []string, env []string) (mcpserver.MCPServer, error) {
	return c.createMCPServerWithID(seeding.NewSlugID(label, "mcp-server"), label, command, args, env)
}

// createMCPServerWithID is CreateMCPServer's own logic, parameterized
// on the new server's id -- the seam ImportMCPServer uses to preserve a
// caller-supplied id (ADR-0036 decision 3).
func (c *ConfigureService) createMCPServerWithID(id, label, command string, args []string, env []string) (mcpserver.MCPServer, error) {
	now := time.Now()
	s := mcpserver.MCPServer{ID: id, Label: label, Command: command, Args: args, Env: env, CreatedAt: now, UpdatedAt: now}
	if err := mcpserver.Validate(s); err != nil {
		return mcpserver.MCPServer{}, err
	}

	if err := entitystore.Insert(&c.mu, &c.mcpServers, c.persistMCPServers, mcpServerDescriptor, s); err != nil {
		return mcpserver.MCPServer{}, err
	}
	dataevent.Emit("mcpserver", s.ID) // goal 0017: live-sync every open surface
	return s, nil
}

func (c *ConfigureService) UpdateMCPServer(id, label, command string, args []string, env []string) (mcpserver.MCPServer, error) {
	s := mcpserver.MCPServer{ID: id, Label: label, Command: command, Args: args, Env: env}
	if err := mcpserver.Validate(s); err != nil {
		return mcpserver.MCPServer{}, err
	}

	updated, err := entitystore.Update(&c.mu, &c.mcpServers, c.persistMCPServers, mcpServerDescriptor, id, func(existing mcpserver.MCPServer) (mcpserver.MCPServer, error) {
		// CreatedAt is preserved from the stored entity, never trusted
		// from the wire; UpdatedAt always advances on a real update.
		s.CreatedAt = existing.CreatedAt
		s.UpdatedAt = time.Now()
		s.Seed = existing.Seed.Touch() // docs/goals/0037 item 2
		return s, nil
	})
	if err != nil {
		return mcpserver.MCPServer{}, err
	}
	dataevent.Emit("mcpserver", updated.ID) // goal 0017: live-sync every open surface
	return updated, nil
}

func (c *ConfigureService) DeleteMCPServer(id string) error {
	announce := func(id string) { dataevent.Emit("mcpserver", id) }
	return deleteEntity(c, "mcpserver", &c.mcpServers, c.persistMCPServers, mcpServerDescriptor,
		func(id string) error { return c.refIntegrityError("mcpserver", "MCP server", id) },
		func(s mcpserver.MCPServer) string { return s.Label }, announce, id)
}

// ListMCPServerTools is a live, on-demand reference lookup (connects to
// the server, lists its tools, disconnects) -- not persisted or synced,
// same "occasional reference lookup, not a live feed" shape HTTPRequests()/
// Lists() themselves already have (the frontend polls them on demand,
// nothing pushes). This is docs/SPEC.md §3.6's actual discoverability
// answer: a user finds the exact toolName to paste into an mcp-tool-call
// node here, not by guessing.
func (c *ConfigureService) ListMCPServerTools(id string) ([]mcpclient.Tool, error) {
	// ContextConfigureToolsPreview (goal 0203 S3), never
	// ContextMCPServerSpawn: this is the Configure page's own reference
	// lookup, not a workflow run, so it carries no run/workflow id.
	rs, err := c.resolveMCPServerWithAccess(id, secretaudit.AccessContext{Context: secretaudit.ContextConfigureToolsPreview})
	if err != nil {
		return nil, err
	}
	// A manual Configure-page reference lookup, not a workflow step --
	// "configure-mcpserver-preview" is a static caller identity (goal
	// 0159 slice 1's audit trail), not a per-run workflow/step id.
	return mcpclient.ListTools(rs.Command, rs.Args, rs.Env, "configure-mcpserver-preview")
}

// --- persistence ---

func (c *ConfigureService) persistMCPServers() error {
	return entitystore.Persist(&c.mu, &c.mcpServers, c.store, mcpServersKey, mcpServerDescriptor)
}

func (c *ConfigureService) restoreMCPServers() {
	entitystore.Load(&c.mu, &c.mcpServers, c.store, mcpServersKey)
}
