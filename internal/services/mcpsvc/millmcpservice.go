// Package mcpsvc exposes Mill's own workflows and Configure data as MCP
// Resources/Tools over HTTP -- Mill acting as an MCP server for an
// external agent host, not as an MCP client or LLM host itself
// (docs/SPEC.md §3.1/§3.6). Write-shaped tools go through the
// park-and-poll approval flow (millmcpservice_approval.go) rather than
// executing unguarded; read Resources call the same Export* methods the
// UI's own Export button uses, never a second read model.
package mcpsvc

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"io/fs"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/mcpaudit"
	"github.com/alicoding/mill/internal/adapters/mcpclient"
	"github.com/alicoding/mill/internal/adapters/mcpserving"
	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// serverInstructions is the MCP spec's own ServerOptions.Instructions
// breadcrumb (goal 0160): kept short per the MCP blog's own guidance --
// a pointer at mill://skill, never a restatement of it.
const serverInstructions = "Mill's tools are guardrailed: reads answer immediately, writes park for human approval. Read mill://skill first -- it covers which tool fits which job, the approval/parking etiquette, and composition norms."

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
	comp *compositionsvc.CompositionService
	cfg  *configuresvc.ConfigureService
	// version is the app version passed in at construction (main.go's
	// millVersion) -- carried here (not just handed to mcpserving.New)
	// so the state manifest (millmcpservice_contract.go, ADR-0036
	// decision 4) reads the same value the updater compares releases
	// against, instead of a second copy of the constant.
	version string
	store   settings.Store
	server  *mcp.Server
	http    *http.Server
	// Per-write approval state: park-and-poll (millmcpservice_approval.go,
	// docs/adr/0032, superseding ADR-0017's second half's old bounded-
	// blocking-wait shape). writes is the durable pending/resolved
	// record set, persisted via store; executors dispatches an approved
	// write's real side effect by tool name (registerWriteExecutor,
	// called once per gated tool during registerTools/
	// registerAuthoringTools -- never mutated afterward, see execute's
	// doc comment).
	writesMu  sync.Mutex
	writes    map[string]*MCPWriteRecord
	executors map[string]mcpWriteExecutor
	// exec backs the authoring tier's list_runs/get_run/run_workflow
	// (millmcpservice_authoring.go); late-bound from main.go.
	exec *executionsvc.ExecutionService
	// atlas backs the atlas_* tools/resource (millmcpservice_atlas.go,
	// millmcpservice_atlas_write.go, goal 0083); late-bound from main.go
	// via SetAtlasService, same construction-order reason as exec above.
	atlas *atlassvc.AtlasService
	// userdocs is the embedded userdocs tree (main.go's userdocsFS,
	// go:embed all:userdocs) -- backs mill://skill (millmcpservice_skill.go,
	// goal 0160), the same construction-injection shape docssvc.New
	// already uses for the in-app Docs surface, so the MCP resource and
	// the human-facing page can never carry two independent copies.
	userdocs fs.FS
	// auditResolver mutates a parked write's audit row once it resolves
	// (goal 0159 slice 1) -- late-bound via SetAuditResolver (main.go),
	// the same injected-seam shape as SetExecutionService/SetAtlasService
	// below, so this package never imports mcpauditsvc directly. nil
	// until wired (every test that doesn't call SetAuditResolver), in
	// which case resolution calls are simply skipped.
	auditResolver func(writeID string, outcome mcpaudit.Outcome, errText string)
}

// SetAuditResolver wires the audit trail's parked-write resolution
// hook (main.go, after mcpauditsvc.New succeeds) -- see the field's own
// doc comment above for why this is late-bound rather than a
// constructor parameter (mcpauditsvc needs a real MCP server instance
// to build its ServerMiddleware from, so it's necessarily constructed
// AFTER this service).
func (m *MillMCPService) SetAuditResolver(fn func(writeID string, outcome mcpaudit.Outcome, errText string)) {
	m.auditResolver = fn
}

// NewMillMCPService builds the MCP server and registers every
// resource/template up front -- registration is static (the resource
// URIs themselves never change), only the data a read returns is
// dynamic (each handler queries comp/cfg fresh on every call, never a
// snapshot taken at construction time). store carries the default-off
// write-tools gate (millmcpservice_tools.go, ADR-0017's Update) --
// read fresh on every import call, so flipping the Settings toggle
// applies immediately, no restart. middleware is applied to the
// server's own receiving chain (goal 0159 slice 1's audit trail,
// mcpauditsvc.ServerMiddleware) -- optional, so a test server with
// nothing to observe passes none.
func NewMillMCPService(version string, comp *compositionsvc.CompositionService, cfg *configuresvc.ConfigureService, store settings.Store, userdocs fs.FS, middleware ...mcp.Middleware) *MillMCPService {
	m := &MillMCPService{comp: comp, cfg: cfg, version: version, store: store, executors: map[string]mcpWriteExecutor{}, userdocs: userdocs}
	m.server = mcpserving.New("mill", version, serverInstructions, middleware...)
	m.registerTools()
	m.registerContractResources()
	m.registerAtlasResources()
	m.registerSkillResource()
	// Restart-survival (docs/adr/0032 §1): reload any pending/recently-
	// resolved write record left over from a previous process. Must run
	// after registerTools (so a loaded record's ToolName resolves
	// against a populated executors map the moment it's approved) but
	// before Start (so a client connecting immediately sees the
	// restored state, not a race against a background load).
	m.loadWrites()

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

	m.server.AddResource(&mcp.Resource{
		URI: "mill://execenvs", Name: "execenvs", MIMEType: "application/json",
		Description: "Every Execution Environment's ID, Label, and shell -- read mill://execenvs/{id} for its full definition (docs/adr/0026).",
	}, m.readExecEnvsIndex)
	m.server.AddResourceTemplate(&mcp.ResourceTemplate{
		URITemplate: "mill://execenvs/{id}", Name: "execenv", MIMEType: "application/json",
		Description: "One Execution Environment's full definition (same shape as its Export button's output).",
	}, m.readExecEnv)

	m.server.AddResource(&mcp.Resource{
		URI: "mill://aiproviders", Name: "aiproviders", MIMEType: "application/json",
		Description: "Every configured AI provider's ID, Label, and kind (openai-compatible/anthropic) -- read mill://aiproviders/{id} for its full definition (docs/goals/0031-ai-node-family.md). Never includes a secret.",
	}, m.readAIProvidersIndex)
	m.server.AddResourceTemplate(&mcp.ResourceTemplate{
		URITemplate: "mill://aiproviders/{id}", Name: "aiprovider", MIMEType: "application/json",
		Description: "One AI provider's full definition, minus its secret (same shape as its Export button's output).",
	}, m.readAIProvider)

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

// ConnectInMemoryClient connects a brand-new MCP client session to THIS
// server via mcp.NewInMemoryTransports() -- no network hop, no second
// process. This is how the agent loop (internal/services/agentloopsvc,
// docs/goals/0101 slice 1) reaches Mill's own governed tool plane: as a
// real MCP client session (list tools, call tools) exactly like an
// external agent host connecting over HTTP would, never via a direct
// Go call into this service's own methods (ADR-0035 -- the loop is
// architecturally a client of this server, not a second entry point
// into it). Each call opens a fresh session; the caller closes it when
// done. clientName identifies the session in any future multi-session
// introspection -- purely descriptive, carries no behavior.
func (m *MillMCPService) ConnectInMemoryClient(ctx context.Context, clientName string) (*mcp.ClientSession, error) {
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	if _, err := m.server.Connect(ctx, serverTransport, nil); err != nil {
		return nil, fmt.Errorf("mcp: connect server transport: %w", err)
	}
	// Built via mcpclient.NewClient, not mcp.NewClient directly -- the
	// ONE choke point every *mcp.Client in Mill goes through (goal 0159
	// slice 1), so this in-memory session automatically carries the same
	// AddSendingMiddleware every other client connection gets, no
	// special path for the agent loop.
	client := mcpclient.NewClient(&mcp.Implementation{Name: clientName, Version: m.version})
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		return nil, fmt.Errorf("mcp: connect client transport: %w", err)
	}
	return session, nil
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
	workflows := m.comp.Workflows()
	out := make([]resourceIndexEntry, 0, len(workflows))
	for _, wf := range workflows {
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
	requests := m.cfg.HTTPRequests()
	out := make([]resourceIndexEntry, 0, len(requests))
	for _, r := range requests {
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
	lists := m.cfg.Lists()
	out := make([]resourceIndexEntry, 0, len(lists))
	for _, l := range lists {
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
	servers := m.cfg.MCPServers()
	out := make([]resourceIndexEntry, 0, len(servers))
	for _, s := range servers {
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
	decisions := m.cfg.Decisions()
	out := make([]resourceIndexEntry, 0, len(decisions))
	for _, d := range decisions {
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

func (m *MillMCPService) readExecEnvsIndex(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	execEnvs := m.cfg.ExecEnvs()
	out := make([]resourceIndexEntry, 0, len(execEnvs))
	for _, e := range execEnvs {
		out = append(out, resourceIndexEntry{ID: e.ID, Label: e.Label, Description: string(e.Shell)})
	}
	return jsonContents(req.Params.URI, out)
}

func (m *MillMCPService) readExecEnv(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	id := idFromTemplateURI(req.Params.URI, "mill://execenvs/")
	data, err := m.cfg.ExportExecEnv(id)
	if err != nil {
		return nil, mcp.ResourceNotFoundError(req.Params.URI)
	}
	return &mcp.ReadResourceResult{
		Contents: []*mcp.ResourceContents{{URI: req.Params.URI, MIMEType: "application/json", Text: data}},
	}, nil
}

func (m *MillMCPService) readAIProvidersIndex(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	providers := m.cfg.AIProviders()
	out := make([]resourceIndexEntry, 0, len(providers))
	for _, p := range providers {
		out = append(out, resourceIndexEntry{ID: p.ID, Label: p.Label, Description: string(p.Kind)})
	}
	return jsonContents(req.Params.URI, out)
}

func (m *MillMCPService) readAIProvider(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	id := idFromTemplateURI(req.Params.URI, "mill://aiproviders/")
	data, err := m.cfg.ExportAIProvider(id)
	if err != nil {
		return nil, mcp.ResourceNotFoundError(req.Params.URI)
	}
	return &mcp.ReadResourceResult{
		Contents: []*mcp.ResourceContents{{URI: req.Params.URI, MIMEType: "application/json", Text: data}},
	}, nil
}
