package main

import (
	"encoding/json"
	"fmt"
	"sync"

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
