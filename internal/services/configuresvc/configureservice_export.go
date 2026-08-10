package configuresvc

import (
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/mcpserver"
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

type exportedList struct {
	Label   string            `json:"label"`
	Entries map[string]string `json:"entries"`
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

	data, err := json.MarshalIndent(exportedList{Label: l.Label, Entries: l.Entries}, "", "  ")
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
	return c.CreateList(in.Label, in.Entries)
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
