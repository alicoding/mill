package mcpsvc

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/mcpserving"
	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// MillMCPService exposes Mill's own workflows/Configure data (not an
// external capability wrapped as a node -- the inverse direction of
// §3.6's mcp-tool-call) as MCP Resources over HTTP: Mill as MCP
// SERVER, the role §3.1 already locked as fine ("fits §1.1 cleanly
// with zero tension"), not the still-disputed MCP-*host* question --
// no LLM runs inside Mill here, an external agent's own host connects
// and reads. Read-only by design (docs/SPEC.md §11, task #12) -- the
// write side (creating/importing via MCP Tools) is deliberately not
// built here; it needs §8's still-OPEN guardrail policy resolved
// first, tracked separately.
//
// Each entity type gets two URIs: a plain "index" Resource
// (mill://workflows) listing every current ID+Label+Description as a
// small JSON array -- enough for an agent to discover what exists and
// construct the next URI -- and a ResourceTemplate
// (mill://workflows/{id}) whose read returns that one entity's full
// definition via the same Export* method the UI's own Export button
// already calls (compositionservice_export.go, configureservice_export.go)
// -- one read-model, not a second one built for this.
type MillMCPService struct {
	comp   *compositionsvc.CompositionService
	cfg    *configuresvc.ConfigureService
	store  settings.Store
	server *mcp.Server
	http   *http.Server
	// Per-write approval state (millmcpservice_approval.go,
	// docs/adr/0017's second half).
	pendingMu     sync.Mutex
	pendingWrites map[string]pendingMCPWrite
	// exec backs the authoring tier's list_runs/get_run/run_workflow
	// (millmcpservice_authoring.go); late-bound from main.go.
	exec *executionsvc.ExecutionService
}

// NewMillMCPService builds the MCP server and registers every
// resource/template up front -- registration is static (the resource
// URIs themselves never change), only the data a read returns is
// dynamic (each handler queries comp/cfg fresh on every call, never a
// snapshot taken at construction time). store carries the default-off
// write-tools gate (millmcpservice_tools.go, ADR-0017's Update) --
// read fresh on every import call, so flipping the Settings toggle
// applies immediately, no restart.
func NewMillMCPService(version string, comp *compositionsvc.CompositionService, cfg *configuresvc.ConfigureService, store settings.Store) *MillMCPService {
	m := &MillMCPService{comp: comp, cfg: cfg, store: store}
	m.server = mcpserving.New("mill", version)
	m.registerTools()

	m.server.AddResource(&mcp.Resource{
		URI: "mill://workflows", Name: "workflows", MIMEType: "application/json",
		Description: "Every workflow's ID, Label, and Description -- read mill://workflows/{id} for one workflow's full definition.",
	}, m.readWorkflowsIndex)
	m.server.AddResourceTemplate(&mcp.ResourceTemplate{
		URITemplate: "mill://workflows/{id}", Name: "workflow", MIMEType: "application/json",
		Description: "One workflow's full definition (same shape as its Export button's output).",
	}, m.readWorkflow)

	m.server.AddResource(&mcp.Resource{
		URI: "mill://requests", Name: "requests", MIMEType: "application/json",
		Description: "Every HTTPRequest's ID, Label, BaseURL, and AuthType -- read mill://requests/{id} for its full definition. Never includes a secret.",
	}, m.readRequestsIndex)
	m.server.AddResourceTemplate(&mcp.ResourceTemplate{
		URITemplate: "mill://requests/{id}", Name: "request", MIMEType: "application/json",
		Description: "One HTTPRequest's full definition, minus its secret (same shape as its Export button's output).",
	}, m.readRequest)

	m.server.AddResource(&mcp.Resource{
		URI: "mill://lists", Name: "lists", MIMEType: "application/json",
		Description: "Every List's ID and Label -- read mill://lists/{id} for its full entries.",
	}, m.readListsIndex)
	m.server.AddResourceTemplate(&mcp.ResourceTemplate{
		URITemplate: "mill://lists/{id}", Name: "list", MIMEType: "application/json",
		Description: "One List's full entries (same shape as its Export button's output).",
	}, m.readList)

	m.server.AddResource(&mcp.Resource{
		URI: "mill://mcpservers", Name: "mcpservers", MIMEType: "application/json",
		Description: "Every configured MCP Server's ID, Label, and Command -- read mill://mcpservers/{id} for its full definition.",
	}, m.readMCPServersIndex)
	m.server.AddResourceTemplate(&mcp.ResourceTemplate{
		URITemplate: "mill://mcpservers/{id}", Name: "mcpserver", MIMEType: "application/json",
		Description: "One configured MCP Server's full definition (same shape as its Export button's output).",
	}, m.readMCPServer)

	m.server.AddResource(&mcp.Resource{
		URI: "mill://decisions", Name: "decisions", MIMEType: "application/json",
		Description: "Every Decision's ID, Label, and category -- read mill://decisions/{id} for its full typed output schema (docs/adr/0027).",
	}, m.readDecisionsIndex)
	m.server.AddResourceTemplate(&mcp.ResourceTemplate{
		URITemplate: "mill://decisions/{id}", Name: "decision", MIMEType: "application/json",
		Description: "One Decision's full definition (same shape as its Export button's output). Never includes its webhook binding -- an HTTPRequest reference is local-instance-only.",
	}, m.readDecision)

	return m
}

// Start binds addr and begins serving in the background. Loopback-only
// by convention of the caller (main.go), not enforced here -- see
// mcpserving.Serve's own doc comment for why this function has no
// opinion on addr.
func (m *MillMCPService) Start(addr string) error {
	httpServer, errCh := mcpserving.Serve(addr, m.server)
	m.http = httpServer
	select {
	case err := <-errCh:
		return fmt.Errorf("mcp server: %w", err)
	case <-time.After(100 * time.Millisecond):
		return nil
	}
}

//wails:ignore
func (m *MillMCPService) Shutdown(ctx context.Context) error {
	if m.http == nil {
		return nil
	}
	return m.http.Shutdown(ctx)
}

func jsonContents(uri string, v any) (*mcp.ReadResourceResult, error) {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return nil, err
	}
	return &mcp.ReadResourceResult{
		Contents: []*mcp.ResourceContents{{URI: uri, MIMEType: "application/json", Text: string(data)}},
	}, nil
}

// idFromTemplateURI extracts {id} from a "scheme://kind/{id}" match --
// Mill's own templates are all this one simple shape (a single trailing
// path segment), so a prefix trim covers every caller here without
// pulling in a general RFC 6570 template-variable extractor for one
// variable.
func idFromTemplateURI(uri, prefix string) string {
	return strings.TrimPrefix(uri, prefix)
}

type resourceIndexEntry struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
}

func (m *MillMCPService) readWorkflowsIndex(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	out := make([]resourceIndexEntry, 0)
	for _, wf := range m.comp.Workflows() {
		out = append(out, resourceIndexEntry{ID: wf.ID, Label: wf.Label, Description: wf.Description})
	}
	return jsonContents(req.Params.URI, out)
}

func (m *MillMCPService) readWorkflow(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	id := idFromTemplateURI(req.Params.URI, "mill://workflows/")
	data, err := m.comp.ExportWorkflow(id)
	if err != nil {
		return nil, mcp.ResourceNotFoundError(req.Params.URI)
	}
	return &mcp.ReadResourceResult{
		Contents: []*mcp.ResourceContents{{URI: req.Params.URI, MIMEType: "application/json", Text: data}},
	}, nil
}

func (m *MillMCPService) readRequestsIndex(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	out := make([]resourceIndexEntry, 0)
	for _, r := range m.cfg.HTTPRequests() {
		out = append(out, resourceIndexEntry{ID: r.ID, Label: r.Label, Description: r.Description})
	}
	return jsonContents(req.Params.URI, out)
}

func (m *MillMCPService) readRequest(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	id := idFromTemplateURI(req.Params.URI, "mill://requests/")
	data, err := m.cfg.ExportHTTPRequest(id)
	if err != nil {
		return nil, mcp.ResourceNotFoundError(req.Params.URI)
	}
	return &mcp.ReadResourceResult{
		Contents: []*mcp.ResourceContents{{URI: req.Params.URI, MIMEType: "application/json", Text: data}},
	}, nil
}

func (m *MillMCPService) readListsIndex(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	out := make([]resourceIndexEntry, 0)
	for _, l := range m.cfg.Lists() {
		out = append(out, resourceIndexEntry{ID: l.ID, Label: l.Label})
	}
	return jsonContents(req.Params.URI, out)
}

func (m *MillMCPService) readList(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	id := idFromTemplateURI(req.Params.URI, "mill://lists/")
	data, err := m.cfg.ExportList(id)
	if err != nil {
		return nil, mcp.ResourceNotFoundError(req.Params.URI)
	}
	return &mcp.ReadResourceResult{
		Contents: []*mcp.ResourceContents{{URI: req.Params.URI, MIMEType: "application/json", Text: data}},
	}, nil
}

func (m *MillMCPService) readMCPServersIndex(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	out := make([]resourceIndexEntry, 0)
	for _, s := range m.cfg.MCPServers() {
		out = append(out, resourceIndexEntry{ID: s.ID, Label: s.Label, Description: s.Command})
	}
	return jsonContents(req.Params.URI, out)
}

func (m *MillMCPService) readMCPServer(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	id := idFromTemplateURI(req.Params.URI, "mill://mcpservers/")
	data, err := m.cfg.ExportMCPServer(id)
	if err != nil {
		return nil, mcp.ResourceNotFoundError(req.Params.URI)
	}
	return &mcp.ReadResourceResult{
		Contents: []*mcp.ResourceContents{{URI: req.Params.URI, MIMEType: "application/json", Text: data}},
	}, nil
}

func (m *MillMCPService) readDecisionsIndex(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	out := make([]resourceIndexEntry, 0)
	for _, d := range m.cfg.Decisions() {
		out = append(out, resourceIndexEntry{ID: d.ID, Label: d.Label, Description: string(d.Category)})
	}
	return jsonContents(req.Params.URI, out)
}

func (m *MillMCPService) readDecision(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	id := idFromTemplateURI(req.Params.URI, "mill://decisions/")
	data, err := m.cfg.ExportDecision(id)
	if err != nil {
		return nil, mcp.ResourceNotFoundError(req.Params.URI)
	}
	return &mcp.ReadResourceResult{
		Contents: []*mcp.ResourceContents{{URI: req.Params.URI, MIMEType: "application/json", Text: data}},
	}, nil
}
