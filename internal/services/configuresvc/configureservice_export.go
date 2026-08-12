package configuresvc

import (
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/mcpserver"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/seeding"
)

// This file extends compositionservice_export.go's workflow export/
// import pattern to Configure's three reusable entity types
// (HTTPRequest, List, MCPServer) -- same design throughout: a dedicated
// wire-shape type per entity (never the domain type directly), ID
// always omitted (import always mints a new entity via the existing
// Create* method, ADR-0013's Duplicate precedent), deterministic JSON
// by construction (already-stored data, Go's own guaranteed struct/
// sorted-map ordering).
//
// Secrets are excluded from every one of these by construction, not by
// a field-stripping step this file has to remember to apply:
// httprequest.HTTPRequest carries no secret field at all (ADR-0007 --
// "the secret itself never lives on an HTTPRequest value"), and
// AuthConfig/JOSEConfig's own doc comments confirm every field on them
// is genuinely non-secret (verified directly against
// internal/domain/httprequest/httprequest.go before relying on it, not
// assumed) -- ClientSecret/signing keys/ConsumerSecret/TokenSecret/
// Mill's own JOSE private key all live in the OS keychain exclusively,
// never on the Go struct this file marshals. List and MCPServer never
// had a secret-shaped field to begin with.

// --- HTTPRequest ---

type exportedHTTPRequest struct {
	Label       string                  `json:"label"`
	Description string                  `json:"description"`
	BaseURL     string                  `json:"baseURL"`
	Method      string                  `json:"method"`
	Body        string                  `json:"body"`
	AuthType    httprequest.AuthType    `json:"authType"`
	Headers     map[string]string       `json:"headers"`
	OpenAPISpec string                  `json:"openAPISpec"`
	Auth        *httprequest.AuthConfig `json:"auth"`
	JOSE        *httprequest.JOSEConfig `json:"jose"`
}

func (c *ConfigureService) ExportHTTPRequest(id string) (string, error) {
	c.mu.Lock()
	var req httprequest.HTTPRequest
	found := false
	for _, r := range c.requests {
		if r.ID == id {
			req = r
			found = true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return "", fmt.Errorf("no request with id %q", id)
	}

	out := exportedHTTPRequest{
		Label:       req.Label,
		Description: req.Description,
		BaseURL:     req.BaseURL,
		Method:      req.Method,
		Body:        req.Body,
		AuthType:    req.AuthType,
		Headers:     req.Headers,
		OpenAPISpec: req.OpenAPISpec,
		Auth:        req.Auth,
		JOSE:        req.JOSE,
	}
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return "", fmt.Errorf("export request: %w", err)
	}
	return string(data), nil
}

// ImportHTTPRequest always creates a new HTTPRequest with no secret set
// -- exportedHTTPRequest never carries one, so the imported request
// starts exactly like a freshly hand-authored one that hasn't had
// SetHTTPRequestSecret called yet, same as CreateHTTPRequest's own
// existing behavior for a request with AuthType != AuthNone.
func (c *ConfigureService) ImportHTTPRequest(jsonData string) (httprequest.HTTPRequest, error) {
	var in exportedHTTPRequest
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return httprequest.HTTPRequest{}, fmt.Errorf("import request: invalid JSON: %w", err)
	}
	return c.CreateHTTPRequest(in.Label, in.BaseURL, in.Method, in.Body, in.AuthType, in.Headers, in.OpenAPISpec, in.Auth, in.JOSE, in.Description)
}

// --- List ---

// exportedList carries the typed shape (Columns/Rows, goal 0011) on
// export, always. Entries stays accepted on IMPORT ONLY, for an old
// export document written before this goal existed -- ImportList
// below runs it through the exact same list.MigrateLegacyEntries a
// real machine's persisted data goes through (configureservice.go's
// migrateLegacyLists), so there's still only one migration code path,
// not two.
type exportedList struct {
	Label       string             `json:"label"`
	Description string             `json:"description,omitempty"`
	Columns     []typedfield.Field `json:"columns,omitempty"`
	Rows        []list.Row         `json:"rows,omitempty"`
	Entries     map[string]string  `json:"entries,omitempty"`
}

func (c *ConfigureService) ExportList(id string) (string, error) {
	c.mu.Lock()
	var l list.List
	found := false
	for _, entry := range c.lists {
		if entry.ID == id {
			l = entry
			found = true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return "", fmt.Errorf("no list with id %q", id)
	}

	data, err := json.MarshalIndent(exportedList{
		Label: l.Label, Description: l.Description, Columns: l.Columns, Rows: l.Rows,
	}, "", "  ")
	if err != nil {
		return "", fmt.Errorf("export list: %w", err)
	}
	return string(data), nil
}

func (c *ConfigureService) ImportList(jsonData string) (list.List, error) {
	var in exportedList
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return list.List{}, fmt.Errorf("import list: invalid JSON: %w", err)
	}
	columns, rows := in.Columns, in.Rows
	if len(columns) == 0 && len(in.Entries) > 0 {
		columns, rows = list.MigrateLegacyEntries(in.Entries, func() string { return seeding.NewSlugID("", "row") })
	}

	created, err := c.CreateList(in.Label, in.Description, columns)
	if err != nil {
		return list.List{}, err
	}
	if len(rows) == 0 {
		return created, nil
	}

	c.mu.Lock()
	idx := c.findListLocked(created.ID)
	if idx == -1 {
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("import list: created list %q vanished", created.ID)
	}
	previous := c.lists[idx]
	c.lists[idx].Rows = rows
	updated := c.lists[idx]
	c.mu.Unlock()

	if err := c.persistLists(); err != nil {
		// Don't leave imported rows sitting in memory only
		// (docs/goals/0025 item 2's memory-vs-store rule) -- the
		// created list itself (empty rows) is already durably
		// persisted via CreateList above, so reverting to it here is
		// exact, not approximate.
		c.mu.Lock()
		c.revertListLocked(previous)
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("import list: save rows: %w", err)
	}
	return updated, nil
}

// --- MCPServer ---

type exportedMCPServer struct {
	Label   string   `json:"label"`
	Command string   `json:"command"`
	Args    []string `json:"args"`
}

func (c *ConfigureService) ExportMCPServer(id string) (string, error) {
	c.mu.Lock()
	var s mcpserver.MCPServer
	found := false
	for _, entry := range c.mcpServers {
		if entry.ID == id {
			s = entry
			found = true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return "", fmt.Errorf("no MCP server with id %q", id)
	}

	data, err := json.MarshalIndent(exportedMCPServer{Label: s.Label, Command: s.Command, Args: s.Args}, "", "  ")
	if err != nil {
		return "", fmt.Errorf("export MCP server: %w", err)
	}
	return string(data), nil
}

func (c *ConfigureService) ImportMCPServer(jsonData string) (mcpserver.MCPServer, error) {
	var in exportedMCPServer
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return mcpserver.MCPServer{}, fmt.Errorf("import MCP server: invalid JSON: %w", err)
	}
	return c.CreateMCPServer(in.Label, in.Command, in.Args)
}

// --- Decision ---

// exportedDecision omits WebhookRequestID deliberately -- an imported
// Decision on a different Mill instance has no guarantee the
// referenced HTTPRequest ID even exists there (same reasoning
// ExportHTTPRequest/exportedHTTPRequest never carries a secret: this
// file's job is portable, safe-to-share config, not a byte-for-byte
// clone of local-only references). The webhook binding is re-authored
// in Configure after import, same as a secret is re-Set after import.
type exportedDecision struct {
	Label    string                `json:"label"`
	Category decision.Category     `json:"category"`
	Outputs  []decision.OutputField `json:"outputs"`
}

func (c *ConfigureService) ExportDecision(id string) (string, error) {
	c.mu.Lock()
	var d decision.Decision
	found := false
	for _, entry := range c.decisions {
		if entry.ID == id {
			d = entry
			found = true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return "", fmt.Errorf("no decision with id %q", id)
	}

	data, err := json.MarshalIndent(exportedDecision{Label: d.Label, Category: d.Category, Outputs: d.Outputs}, "", "  ")
	if err != nil {
		return "", fmt.Errorf("export decision: %w", err)
	}
	return string(data), nil
}

func (c *ConfigureService) ImportDecision(jsonData string) (decision.Decision, error) {
	var in exportedDecision
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return decision.Decision{}, fmt.Errorf("import decision: invalid JSON: %w", err)
	}
	return c.CreateDecision(in.Label, in.Category, in.Outputs, "")
}

// --- AIProvider ---

// exportedAIProvider omits any secret by construction, same as every
// other exported*/Export* shape in this file -- AIProvider carries no
// secret field at all (aiprovider.AIProvider's own doc comment), so
// there's nothing to strip.
type exportedAIProvider struct {
	Label   string          `json:"label"`
	Kind    aiprovider.Kind `json:"kind"`
	BaseURL string          `json:"baseURL"`
	Model   string          `json:"model"`
}

func (c *ConfigureService) ExportAIProvider(id string) (string, error) {
	c.mu.Lock()
	var p aiprovider.AIProvider
	found := false
	for _, entry := range c.aiProviders {
		if entry.ID == id {
			p = entry
			found = true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return "", fmt.Errorf("no AI provider with id %q", id)
	}

	data, err := json.MarshalIndent(exportedAIProvider{Label: p.Label, Kind: p.Kind, BaseURL: p.BaseURL, Model: p.Model}, "", "  ")
	if err != nil {
		return "", fmt.Errorf("export AI provider: %w", err)
	}
	return string(data), nil
}

// ImportAIProvider always creates a new AIProvider with no secret set --
// exportedAIProvider never carries one, same as ImportMCPServer's own
// no-credential-to-import shape.
func (c *ConfigureService) ImportAIProvider(jsonData string) (aiprovider.AIProvider, error) {
	var in exportedAIProvider
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return aiprovider.AIProvider{}, fmt.Errorf("import AI provider: invalid JSON: %w", err)
	}
	return c.CreateAIProvider(in.Label, in.Kind, in.BaseURL, in.Model)
}
