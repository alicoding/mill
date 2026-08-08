package main

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/openapispec"
	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/connector"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/mcpserver"
)

// validateOpenAPISpec rejects a Connector save whose OpenAPISpec field
// doesn't parse -- an empty spec is valid (ADR-0007: OpenAPISpec is
// optional, a Connector with none behaves exactly as before this field
// existed). Parsing/validating a Connector's raw spec text is a
// commodity-adapter concern (internal/adapters/openapispec), not core
// domain, so it lives here at the service layer rather than inside
// connector.Validate -- internal/domain/connector stays pure per
// CLAUDE.md's domain-purity rule, same reasoning ConfigureService
// already applies to credential.Delete/Set below.
func validateOpenAPISpec(spec string) error {
	if spec == "" {
		return nil
	}
	if _, err := openapispec.Parse([]byte(spec)); err != nil {
		return fmt.Errorf("OpenAPI spec: %w", err)
	}
	return nil
}

// connectorsKey/listsKey mirror workflowsKey's shape (compositionservice.go):
// one atomic JSON blob per entity kind, sharing the same settings.json
// file rather than a new store/file per entity.
const (
	connectorsKey = "configure-connectors"
	listsKey      = "configure-lists"
)

// ConfigureService is the Wails-facing layer over Configure-authored data
// (docs/SPEC.md §3.5): Connectors, Lists, and (delegated to
// CompositionService) a workflow's Attributes schema. Mirrors
// CompositionService's own shape -- state + persistence a stateless
// domain package can't own, no domain logic of its own.
//
// It also owns wiring composition.go's connector-lookup and list-lookup
// seams (SetConnectorLookup/SetListLookup) to its own resolve* methods --
// composition.go doesn't (and shouldn't) import this package directly,
// same reasoning as CompositionService's Syncer interface for
// TriggerService.
type ConfigureService struct {
	mu          sync.Mutex
	store       settings.Store
	connectors  []connector.Connector
	lists       []list.List
	mcpServers  []mcpserver.MCPServer
	composition *CompositionService
}

func NewConfigureService(store settings.Store, comp *CompositionService) *ConfigureService {
	c := &ConfigureService{store: store, composition: comp}
	c.restore()
	c.restoreMCPServers()
	composition.SetConnectorLookup(c.resolveConnector)
	composition.SetListLookup(c.resolveList)
	composition.SetMCPServerLookup(c.resolveMCPServer)
	return c
}

// resolveConnector implements composition.go's lookupConnectorFn seam:
// find the Connector, fetch its secret from the OS keychain (skipped
// entirely for AuthNone -- there's nothing to fetch), return both as a
// composition.ResolvedConnector. Unexported, so Wails never binds it as
// a callable frontend method -- it's Go-internal wiring only, same as
// CompositionService's SetSyncer.
func (c *ConfigureService) resolveConnector(id string) (composition.ResolvedConnector, error) {
	c.mu.Lock()
	var conn connector.Connector
	found := false
	for _, cn := range c.connectors {
		if cn.ID == id {
			conn = cn
			found = true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return composition.ResolvedConnector{}, fmt.Errorf("no connector with id %q", id)
	}

	var secret string
	if conn.AuthType != connector.AuthNone {
		s, err := credential.Get(id)
		if err != nil {
			return composition.ResolvedConnector{}, fmt.Errorf("connector %q: %w", id, err)
		}
		secret = s
	}

	return composition.ResolvedConnector{
		BaseURL:     conn.BaseURL,
		AuthType:    conn.AuthType,
		Headers:     conn.Headers,
		Secret:      secret,
		OpenAPISpec: conn.OpenAPISpec,
	}, nil
}

// resolveList implements composition.go's lookupListFn seam.
func (c *ConfigureService) resolveList(id string) (composition.ResolvedList, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, l := range c.lists {
		if l.ID == id {
			return composition.ResolvedList{Entries: l.Entries}, nil
		}
	}
	return composition.ResolvedList{}, fmt.Errorf("no list with id %q", id)
}

// --- Connectors ---

func (c *ConfigureService) Connectors() []connector.Connector {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]connector.Connector, len(c.connectors))
	copy(out, c.connectors)
	return out
}

func (c *ConfigureService) CreateConnector(label, connType, baseURL string, authType connector.AuthType, headers map[string]string, openAPISpec string) (connector.Connector, error) {
	conn := connector.Connector{
		ID: newSlugID(label, "connector"), Label: label, Type: connType,
		BaseURL: baseURL, AuthType: authType, Headers: headers, OpenAPISpec: openAPISpec,
	}
	if err := connector.Validate(conn); err != nil {
		return connector.Connector{}, err
	}
	if err := validateOpenAPISpec(openAPISpec); err != nil {
		return connector.Connector{}, err
	}

	c.mu.Lock()
	c.connectors = append(c.connectors, conn)
	c.mu.Unlock()

	c.persistConnectors()
	return conn, nil
}

func (c *ConfigureService) UpdateConnector(id, label, connType, baseURL string, authType connector.AuthType, headers map[string]string, openAPISpec string) (connector.Connector, error) {
	conn := connector.Connector{ID: id, Label: label, Type: connType, BaseURL: baseURL, AuthType: authType, Headers: headers, OpenAPISpec: openAPISpec}
	if err := connector.Validate(conn); err != nil {
		return connector.Connector{}, err
	}
	if err := validateOpenAPISpec(openAPISpec); err != nil {
		return connector.Connector{}, err
	}

	c.mu.Lock()
	idx := -1
	for i, cn := range c.connectors {
		if cn.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return connector.Connector{}, fmt.Errorf("no connector with id %q", id)
	}
	c.connectors[idx] = conn
	c.mu.Unlock()

	c.persistConnectors()
	return conn, nil
}

// DeleteConnector also removes any keychain secret for id -- best-effort
// (credential.Delete on an id with no stored secret, e.g. an AuthNone
// connector, is a harmless no-op-shaped error, not surfaced), so a
// deleted connector never leaves an orphaned secret behind in the OS
// keychain.
func (c *ConfigureService) DeleteConnector(id string) error {
	c.mu.Lock()
	idx := -1
	for i, cn := range c.connectors {
		if cn.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return fmt.Errorf("no connector with id %q", id)
	}
	c.connectors = append(c.connectors[:idx], c.connectors[idx+1:]...)
	c.mu.Unlock()

	c.persistConnectors()
	_ = credential.Delete(id)
	return nil
}

// ListConnectorOperations parses id's stored OpenAPISpec and returns
// every operation it declares -- the discoverability answer for a
// Connector's schema, same shape as ListMCPServerTools
// (configuremcpserver.go, §3.6): a user finds the exact path+method to
// reference from a workflow node here, not by guessing. Returns an
// error for a Connector with no OpenAPISpec set, rather than an empty
// list, so the frontend can distinguish "nothing declared yet" from
// "real spec, zero operations."
func (c *ConfigureService) ListConnectorOperations(id string) ([]openapispec.OperationRef, error) {
	c.mu.Lock()
	var spec string
	found := false
	for _, cn := range c.connectors {
		if cn.ID == id {
			spec, found = cn.OpenAPISpec, true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return nil, fmt.Errorf("no connector with id %q", id)
	}
	if spec == "" {
		return nil, fmt.Errorf("connector %q has no OpenAPI spec configured", id)
	}
	doc, err := openapispec.Parse([]byte(spec))
	if err != nil {
		return nil, err
	}
	return doc.Operations(), nil
}

// ConnectorOperationFields resolves one connector operation's declared
// input/output fields (ADR-0007 Phase 3) -- the data the canvas
// Inspector's binding editor renders once a user picks an operation
// from ListConnectorOperations above. Mirrors that method's own
// lookup/parse shape.
func (c *ConfigureService) ConnectorOperationFields(id, path, method string) (openapispec.Operation, error) {
	c.mu.Lock()
	var spec string
	found := false
	for _, cn := range c.connectors {
		if cn.ID == id {
			spec, found = cn.OpenAPISpec, true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return openapispec.Operation{}, fmt.Errorf("no connector with id %q", id)
	}
	if spec == "" {
		return openapispec.Operation{}, fmt.Errorf("connector %q has no OpenAPI spec configured", id)
	}
	doc, err := openapispec.Parse([]byte(spec))
	if err != nil {
		return openapispec.Operation{}, err
	}
	op, err := doc.Operation(path, method)
	if err != nil {
		return openapispec.Operation{}, err
	}
	return *op, nil
}

// SetConnectorSecret writes id's secret to the OS keychain. Write-only
// by design (docs/SPEC.md §3.5): there is deliberately no GetSecret
// binding anywhere on this service -- the frontend can set a secret but
// can never read one back, matching 1Password's own pattern.
func (c *ConfigureService) SetConnectorSecret(id, secret string) error {
	c.mu.Lock()
	exists := false
	for _, cn := range c.connectors {
		if cn.ID == id {
			exists = true
			break
		}
	}
	c.mu.Unlock()
	if !exists {
		return fmt.Errorf("no connector with id %q", id)
	}
	return credential.Set(id, secret)
}

// DeleteConnectorSecret clears id's secret without deleting the
// connector itself -- e.g. switching a connector back to AuthNone.
func (c *ConfigureService) DeleteConnectorSecret(id string) error {
	return credential.Delete(id)
}

// --- Lists ---

func (c *ConfigureService) Lists() []list.List {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]list.List, len(c.lists))
	copy(out, c.lists)
	return out
}

func (c *ConfigureService) CreateList(label string, entries map[string]string) (list.List, error) {
	l := list.List{ID: newSlugID(label, "list"), Label: label, Entries: entries}
	if err := list.Validate(l); err != nil {
		return list.List{}, err
	}

	c.mu.Lock()
	c.lists = append(c.lists, l)
	c.mu.Unlock()

	c.persistLists()
	return l, nil
}

func (c *ConfigureService) UpdateList(id, label string, entries map[string]string) (list.List, error) {
	l := list.List{ID: id, Label: label, Entries: entries}
	if err := list.Validate(l); err != nil {
		return list.List{}, err
	}

	c.mu.Lock()
	idx := -1
	for i, existing := range c.lists {
		if existing.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("no list with id %q", id)
	}
	c.lists[idx] = l
	c.mu.Unlock()

	c.persistLists()
	return l, nil
}

func (c *ConfigureService) DeleteList(id string) error {
	c.mu.Lock()
	idx := -1
	for i, l := range c.lists {
		if l.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return fmt.Errorf("no list with id %q", id)
	}
	c.lists = append(c.lists[:idx], c.lists[idx+1:]...)
	c.mu.Unlock()

	c.persistLists()
	return nil
}

// --- Attributes (delegates to CompositionService -- see SPEC.md §3.5's
// "Configure-authored but workflow-scoped" cardinality note) ---

func (c *ConfigureService) UpdateWorkflowAttributes(workflowID string, attrs []composition.AttributeDef) (composition.Workflow, error) {
	return c.composition.UpdateAttributes(workflowID, attrs)
}

// --- persistence ---

func (c *ConfigureService) persistConnectors() {
	c.mu.Lock()
	connectors := make([]connector.Connector, len(c.connectors))
	copy(connectors, c.connectors)
	c.mu.Unlock()

	data, err := json.Marshal(connectors)
	if err != nil {
		return
	}
	_ = c.store.Set(connectorsKey, string(data))
}

func (c *ConfigureService) persistLists() {
	c.mu.Lock()
	lists := make([]list.List, len(c.lists))
	copy(lists, c.lists)
	c.mu.Unlock()

	data, err := json.Marshal(lists)
	if err != nil {
		return
	}
	_ = c.store.Set(listsKey, string(data))
}

func (c *ConfigureService) restore() {
	if raw, ok := c.store.Get(connectorsKey).(string); ok && raw != "" {
		var connectors []connector.Connector
		if err := json.Unmarshal([]byte(raw), &connectors); err == nil {
			c.connectors = connectors
		}
	}
	if raw, ok := c.store.Get(listsKey).(string); ok && raw != "" {
		var lists []list.List
		if err := json.Unmarshal([]byte(raw), &lists); err == nil {
			c.lists = lists
		}
	}
}
