package configuresvc

import (
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/contract"
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/mcpserver"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/seeding"
)

// This file extends compositionservice_export.go's workflow export/
// import pattern to Configure's six reusable entity types -- same
// design throughout: a dedicated wire-shape type per entity (never the
// domain type directly), deterministic JSON by construction (already-
// stored data, Go's own guaranteed struct/sorted-map ordering).
//
// Schema and ID (ADR-0036) follow the uniform rule every Import* below
// implements: Schema carries the envelope's contract id (absent is
// accepted on import, for every pre-ADR-0036 export); ID is always
// emitted on export and, on import, absent mints a fresh entity (ADR-
// 0013's Duplicate precedent, unchanged), present-and-unknown creates
// preserving it, present-and-known updates through the entity's
// existing Update* method.
//
// Secrets are excluded from every one of these by construction, not by
// a field-stripping step this file has to remember to apply: no
// exported entity has ever carried a secret VALUE. Since goal 0306
// every secret-shaped field holds a reference instead -- a name, not a
// credential -- so a reference travels with the export exactly as a
// "vault:" header value always has. An import whose references name
// entries this device's store does not hold is a request with its
// secrets not yet chosen, which the request form says plainly.

// --- HTTPRequest ---

type exportedHTTPRequest struct {
	Schema      string                  `json:"schema"`
	ID          string                  `json:"id,omitempty"`
	Label       string                  `json:"label"`
	Description string                  `json:"description"`
	BaseURL     string                  `json:"baseURL"`
	Method      string                  `json:"method"`
	Body        string                  `json:"body"`
	AuthType    httprequest.AuthType    `json:"authType"`
	SecretRef   string                  `json:"secretRef,omitempty"`
	Headers     map[string]string       `json:"headers"`
	OpenAPISpec string                  `json:"openAPISpec"`
	Auth        *httprequest.AuthConfig `json:"auth,omitempty"`
	JOSE        *httprequest.JOSEConfig `json:"jose,omitempty"`
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
		Schema:      contract.SchemaID("request"),
		ID:          req.ID,
		Label:       req.Label,
		Description: req.Description,
		BaseURL:     req.BaseURL,
		Method:      req.Method,
		Body:        req.Body,
		AuthType:    req.AuthType,
		SecretRef:   req.SecretRef,
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

// ImportHTTPRequest applies ADR-0036 decision 3's uniform import rule
// (this file's own header comment). No secret ever round-trips --
// exportedHTTPRequest never carries one, so a created-preserving-id or
// freshly created request starts exactly like a hand-authored one that
// hasn't had SetHTTPRequestSecret called yet; an updated request keeps
// its existing local secret untouched (UpdateHTTPRequest never touches
// it either).
func (c *ConfigureService) ImportHTTPRequest(jsonData string) (httprequest.HTTPRequest, error) {
	var in exportedHTTPRequest
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return httprequest.HTTPRequest{}, fmt.Errorf("import request: invalid JSON: %w", err)
	}
	if err := contract.ValidateImportSchema("request", in.Schema); err != nil {
		return httprequest.HTTPRequest{}, fmt.Errorf("import request: %w", err)
	}

	if in.ID != "" {
		c.mu.Lock()
		found := c.requestExistsLocked(in.ID)
		c.mu.Unlock()
		if found {
			return c.UpdateHTTPRequest(in.ID, in.Label, in.BaseURL, in.Method, in.Body, in.AuthType, in.SecretRef, in.Headers, in.OpenAPISpec, in.Auth, in.JOSE, in.Description)
		}
		return c.createHTTPRequestWithID(in.ID, in.Label, in.BaseURL, in.Method, in.Body, in.AuthType, in.SecretRef, in.Headers, in.OpenAPISpec, in.Auth, in.JOSE, in.Description)
	}
	return c.CreateHTTPRequest(in.Label, in.BaseURL, in.Method, in.Body, in.AuthType, in.SecretRef, in.Headers, in.OpenAPISpec, in.Auth, in.JOSE, in.Description)
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
	Schema      string             `json:"schema"`
	ID          string             `json:"id,omitempty"`
	Label       string             `json:"label"`
	Description string             `json:"description,omitempty"`
	Columns     []typedfield.Field `json:"columns,omitempty"`
	Rows        []list.Row         `json:"rows,omitempty"`
	Entries     map[string]string  `json:"entries,omitempty"`
	// FieldTombstones round-trips this List's own deleted-Column
	// history (docs/adr/0040 decision 3) so the same evolution
	// semantics apply on import as on a live UI edit -- optional,
	// absent for every export written before this field existed.
	FieldTombstones []typedfield.FieldTombstone `json:"fieldTombstones,omitempty"`
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
		Schema: contract.SchemaID("list"), ID: l.ID,
		Label: l.Label, Description: l.Description, Columns: l.Columns, Rows: l.Rows,
		FieldTombstones: l.FieldTombstones,
	}, "", "  ")
	if err != nil {
		return "", fmt.Errorf("export list: %w", err)
	}
	return string(data), nil
}

// ImportList applies ADR-0036 decision 3's uniform import rule (this
// file's own header comment); the id-present-and-known path routes
// through UpdateList rather than the create-only path Entries-migration
// legacy exports also used, then applies rows the same way as a fresh
// create.
func (c *ConfigureService) ImportList(jsonData string) (list.List, error) {
	var in exportedList
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return list.List{}, fmt.Errorf("import list: invalid JSON: %w", err)
	}
	if err := contract.ValidateImportSchema("list", in.Schema); err != nil {
		return list.List{}, fmt.Errorf("import list: %w", err)
	}
	columns, rows := in.Columns, in.Rows
	if len(columns) == 0 && len(in.Entries) > 0 {
		columns, rows = list.MigrateLegacyEntries(in.Entries, func() string { return seeding.NewSlugID("", "row") })
	}

	var target list.List
	var err error
	if in.ID != "" {
		c.mu.Lock()
		found := c.findListLocked(in.ID) != -1
		c.mu.Unlock()
		if found {
			target, err = c.UpdateList(in.ID, in.Label, in.Description, columns, in.FieldTombstones)
		} else {
			target, err = c.createListWithID(in.ID, in.Label, in.Description, columns, in.FieldTombstones)
		}
	} else {
		target, err = c.CreateList(in.Label, in.Description, columns)
	}
	if err != nil {
		return list.List{}, err
	}
	if len(rows) == 0 {
		return target, nil
	}

	c.mu.Lock()
	idx := c.findListLocked(target.ID)
	if idx == -1 {
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("import list: list %q vanished", target.ID)
	}
	previous := c.lists[idx]
	c.lists[idx].Rows = rows
	updated := c.lists[idx]
	c.mu.Unlock()

	if err := c.persistLists(); err != nil {
		// Don't leave imported rows sitting in memory only
		// (docs/goals/0025 item 2's memory-vs-store rule) -- target
		// itself (pre-row-overwrite state) is already durably
		// persisted via Create/UpdateList above, so reverting to it
		// here is exact, not approximate.
		c.mu.Lock()
		c.revertListLocked(previous)
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("import list: save rows: %w", err)
	}
	return updated, nil
}

// --- MCPServer ---

// Env is safe to export/import verbatim exactly when every entry is a
// "vault:" reference (vaultref.Parse) -- a pointer, never the secret
// value itself, same as every other exported shape in this file (this
// package's own doc comment: "no exported shape carries a secret
// because no in-memory shape does"). A literal (non-"vault:") Env
// value is NOT specially guarded here -- same known gap
// execenv.ExecEnv.Env's own doc comment names for plain, non-referenced
// environment values. Applies identically to exportedExecEnv's own Env
// field and exportedHTTPRequest's own Headers field below (goal 0203
// S1 made both fields vault-referenceable): export/import always
// carries whatever's actually stored, never a resolved secret, because
// resolution only ever happens at run time (resolveMCPServerEnv/
// resolveExecEnv/resolveHTTPRequest), never on this path.
type exportedMCPServer struct {
	Schema  string   `json:"schema"`
	ID      string   `json:"id,omitempty"`
	Label   string   `json:"label"`
	Command string   `json:"command"`
	Args    []string `json:"args"`
	Env     []string `json:"env,omitempty"`
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

	data, err := json.MarshalIndent(exportedMCPServer{Schema: contract.SchemaID("mcpserver"), ID: s.ID, Label: s.Label, Command: s.Command, Args: s.Args, Env: s.Env}, "", "  ")
	if err != nil {
		return "", fmt.Errorf("export MCP server: %w", err)
	}
	return string(data), nil
}

// ImportMCPServer/ImportAIProvider/the generic importUniform dispatch
// they share live in configureservice_import_generic.go (dupl-gate
// exclusion: see that file's own header comment).

// --- Decision ---

// exportedDecision omits WebhookRequestID deliberately -- an imported
// Decision on a different Mill instance has no guarantee the
// referenced HTTPRequest ID even exists there (same reasoning
// ExportHTTPRequest/exportedHTTPRequest never carries a secret: this
// file's job is portable, safe-to-share config, not a byte-for-byte
// clone of local-only references). The webhook binding is re-authored
// in Configure after import, same as a secret is re-Set after import.
type exportedDecision struct {
	Schema   string                 `json:"schema"`
	ID       string                 `json:"id,omitempty"`
	Label    string                 `json:"label"`
	Category decision.Category      `json:"category"`
	Outputs  []decision.OutputField `json:"outputs"`
	// FieldTombstones round-trips this Decision's own deleted-Output
	// history (docs/adr/0040 decision 3) so the same evolution
	// semantics apply on import as on a live UI edit -- optional,
	// absent for every export written before this field existed.
	FieldTombstones []typedfield.FieldTombstone `json:"fieldTombstones,omitempty"`
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

	data, err := json.MarshalIndent(exportedDecision{
		Schema: contract.SchemaID("decision"), ID: d.ID, Label: d.Label, Category: d.Category,
		Outputs: d.Outputs, FieldTombstones: d.FieldTombstones,
	}, "", "  ")
	if err != nil {
		return "", fmt.Errorf("export decision: %w", err)
	}
	return string(data), nil
}

// ImportDecision applies ADR-0036 decision 3's uniform import rule
// (this file's own header comment). WebhookRequestID is never part of
// the wire shape (exportedDecision's own doc comment); an update
// through this path clears it to the same "re-author it after import"
// state a create already left it in, since UpdateDecision has no other
// value to preserve it from.
func (c *ConfigureService) ImportDecision(jsonData string) (decision.Decision, error) {
	var in exportedDecision
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return decision.Decision{}, fmt.Errorf("import decision: invalid JSON: %w", err)
	}
	if err := contract.ValidateImportSchema("decision", in.Schema); err != nil {
		return decision.Decision{}, fmt.Errorf("import decision: %w", err)
	}

	if in.ID != "" {
		c.mu.Lock()
		found := c.decisionExistsLocked(in.ID)
		c.mu.Unlock()
		if found {
			return c.UpdateDecision(in.ID, in.Label, in.Category, in.Outputs, in.FieldTombstones, "")
		}
		return c.createDecisionWithID(in.ID, in.Label, in.Category, in.Outputs, in.FieldTombstones, "")
	}
	return c.CreateDecision(in.Label, in.Category, in.Outputs, "")
}

// --- AIProvider ---

// exportedAIProvider omits any secret by construction, same as every
// other exported*/Export* shape in this file: KeyRef names an entry in
// the secret store (goal 0306), it is not the key.
type exportedAIProvider struct {
	Schema  string          `json:"schema"`
	ID      string          `json:"id,omitempty"`
	Label   string          `json:"label"`
	Kind    aiprovider.Kind `json:"kind"`
	BaseURL string          `json:"baseURL"`
	Model   string          `json:"model"`
	KeyRef  string          `json:"keyRef,omitempty"`
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

	data, err := json.MarshalIndent(exportedAIProvider{Schema: contract.SchemaID("aiprovider"), ID: p.ID, Label: p.Label, Kind: p.Kind, BaseURL: p.BaseURL, Model: p.Model, KeyRef: p.KeyRef}, "", "  ")
	if err != nil {
		return "", fmt.Errorf("export AI provider: %w", err)
	}
	return string(data), nil
}

// ImportAIProvider lives in configureservice_import_generic.go, along
// with ImportMCPServer (dupl-gate exclusion: see that file's own header
// comment). No secret ever round-trips through it -- exportedAIProvider
// never carries one, same as ImportMCPServer's own no-credential-to-
// import shape; an updated provider keeps its existing local secret
// untouched (UpdateAIProvider never touches it either).
