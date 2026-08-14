package mcpsvc

import (
	"context"

	"github.com/alicoding/mill/internal/adapters/buildinfo"
	"github.com/alicoding/mill/internal/contract"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// registerContractResources wires the two read-only, ungated resources
// goal 0052 item 4/6 add: mill://manifest (this instance's version/
// commit/mode/schema majors) and mill://contract (the whole agent-
// facing surface in one document -- every envelope schema, the node
// catalog, and the import contract, plus the live manifest). Called
// once from NewMillMCPService, same static-registration shape as every
// other resource there.
func (m *MillMCPService) registerContractResources() {
	m.server.AddResource(&mcp.Resource{
		URI: "mill://manifest", Name: "manifest", MIMEType: "application/json",
		Description: "This Mill instance's version, commit, modified flag, mode (desktop/server), and every supported schema family's id -- read this to know which build an export or the contract document came from.",
	}, m.readManifest)

	m.server.AddResource(&mcp.Resource{
		URI: "mill://contract", Name: "contract", MIMEType: "application/json",
		Description: "The whole agent-facing contract in one document: every envelope schema, the node-type catalog, the import/update rule, and this instance's manifest -- the transport form for environments where MCP itself isn't reachable (goal 0052).",
	}, m.readContract)
}

// manifest reads a fresh build-info snapshot on every call (cheap: an
// executable stat + the process's own embedded VCS settings) rather
// than caching one at construction, so a value can never go stale
// across the process lifetime even though none of BuildInfo's fields
// actually change after start.
func (m *MillMCPService) manifest() contract.Manifest {
	build := buildinfo.Read()
	return contract.BuildManifest(m.version, build.Revision, build.Modified, build.Server)
}

func (m *MillMCPService) readManifest(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	return jsonContents(req.Params.URI, m.manifest())
}

func (m *MillMCPService) readContract(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	data, err := contract.Served(m.manifest())
	if err != nil {
		return nil, err
	}
	return &mcp.ReadResourceResult{
		Contents: []*mcp.ResourceContents{{URI: req.Params.URI, MIMEType: "application/json", Text: string(data)}},
	}, nil
}

// ContractDocument is the same mill://contract read, exposed as a plain
// method for settingssvc.SettingsService.ExportContract to call --
// MillMCPService isn't itself a Wails-bound service (docs/SPEC.md
// §9.5's MCP-plane list), so the UI's Export contract action reaches it
// through the same late-bound s.mcpService proxy SettingsService already
// uses for PendingMCPWrites/ResolvedMCPWrites.
func (m *MillMCPService) ContractDocument() (string, error) {
	data, err := contract.Served(m.manifest())
	if err != nil {
		return "", err
	}
	return string(data), nil
}
