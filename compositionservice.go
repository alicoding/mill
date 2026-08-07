package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"sync"

	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/composition"
)

// workflowsKey is the single settings-store key holding every
// user-composed workflow as one JSON blob -- same shape as
// triggerHotkeyBindingsKey (triggerservice.go): one atomic read/write,
// sharing the same settings.json file rather than a second store/file.
// This is persistence for a workflow's authored *definition* (which
// nodes/edges, what config) -- a separate, already-settled concern from
// SPEC.md §7's still-open question of persisting/resuming a *running*
// workflow's execution state, which this does not touch or presuppose.
//
// Versioned ("-v2") because the persisted shape just changed (Steps ->
// Nodes+Edges, see composition.go's canvas migration): restore() already
// silently discards on unmarshal failure, so keeping the old key would
// mean old-shape data gets actively read and dropped on next launch.
// Renaming the key instead orphans it harmlessly. This is single-
// maintainer prototype data -- a real migration isn't warranted.
const workflowsKey = "composition-workflows-v2"

var nonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

// Syncer is the seam CompositionService uses to tell TriggerService
// (triggerservice.go) "the workflow set changed, re-register whatever
// needs it" -- an interface, not a *TriggerService field directly,
// purely so this file doesn't have to know TriggerService's own
// construction order (it's wired in from main.go via SetSyncer once both
// services exist; TriggerService's constructor needs a *CompositionService
// to call RunWorkflow, so the two can't be constructed from a single
// mutual constructor call).
type Syncer interface {
	Sync(workflows []composition.Workflow)
}

// CompositionService is the Wails-facing layer over the composition
// domain package -- it holds no domain logic of its own (that's
// internal/domain/composition), only the state and persistence a
// stateless package can't own: user-composed workflows, mirroring
// TriggerService's own shape (triggerservice.go) rather than inventing a
// new one. See docs/SPEC.md §3's `UX: PROTOTYPE` entry for what this is
// testing.
type CompositionService struct {
	mu     sync.Mutex
	store  settings.Store
	user   []composition.Workflow
	syncer Syncer
}

func NewCompositionService(store settings.Store) *CompositionService {
	c := &CompositionService{store: store}
	c.restore()
	return c
}

// SetSyncer wires the syncer notified after every workflow mutation.
// Called once from main.go after both services exist -- see the Syncer
// doc comment above for why this can't just be a constructor parameter.
//
// wails:ignore -- Go-internal wiring only.
//
//wails:ignore
func (c *CompositionService) SetSyncer(s Syncer) {
	c.syncer = s
}

// notifySyncer re-registers every workflow's trigger listener after a
// mutation -- a no-op until SetSyncer has run (defensive, not expected
// to matter: main.go wires it immediately after construction, before any
// real request reaches this service).
func (c *CompositionService) notifySyncer() {
	if c.syncer != nil {
		c.syncer.Sync(c.Workflows())
	}
}

func (c *CompositionService) NodeTypes() []composition.NodeType {
	return composition.NodeTypes()
}

// CapabilityMap exposes docs/SPEC.md §3.3's capability map as real data
// for the Spec tab -- see docs/SPEC.md §3.3 and CapabilityIndex.tsx's
// existing "real Go data, not parsed docs" precedent for page-level
// capabilities, applied here one level down for composition's own
// sub-capabilities.
func (c *CompositionService) CapabilityMap() []composition.MapEntry {
	return composition.CapabilityMap()
}

// Workflows returns every workflow -- seeded examples and user-composed
// ones alike, all ordinary entries in c.user (see restore's first-run
// seeding below). No BuiltInWorkflows() call here: once seeded, they're
// just data, the same industry pattern confirmed in docs/SPEC.md §2.2's
// Update note (a Zapier template "operates independently... you can edit
// it like any other Zap" the moment it exists) -- not a protected
// specimen re-appended on every read.
func (c *CompositionService) Workflows() []composition.Workflow {
	c.mu.Lock()
	defer c.mu.Unlock()

	out := make([]composition.Workflow, len(c.user))
	copy(out, c.user)
	return out
}

// CreateWorkflow composes and configures a new workflow in one step, per
// SPEC.md §3: ResolveNodeDefaults validates every node's type and fills
// in any missing config with that field's default, so the stored
// workflow is never partially configured. The graph shape itself (does
// it form one valid chain?) isn't re-checked here -- ExecuteWorkflow
// validates that at run time, and the canvas is separately designed to
// prevent drawing an invalid graph in the first place.
func (c *CompositionService) CreateWorkflow(label, description string, nodes []composition.Node, edges []composition.Edge) (composition.Workflow, error) {
	if strings.TrimSpace(label) == "" {
		return composition.Workflow{}, fmt.Errorf("a workflow needs a label")
	}
	if len(nodes) == 0 {
		return composition.Workflow{}, fmt.Errorf("a workflow needs at least one node")
	}

	resolved, err := composition.ResolveNodeDefaults(nodes)
	if err != nil {
		return composition.Workflow{}, err
	}
	if err := composition.ValidateGraph(resolved, edges, nil); err != nil {
		return composition.Workflow{}, err
	}

	wf := composition.Workflow{
		ID:          newWorkflowID(label),
		Label:       label,
		Description: description,
		Nodes:       resolved,
		Edges:       edges,
		BuiltIn:     false,
	}

	c.mu.Lock()
	c.user = append(c.user, wf)
	c.mu.Unlock()

	c.persist()
	c.notifySyncer()
	return wf, nil
}

// UpdateWorkflow replaces an existing user-composed workflow's nodes/
// edges (and label/description) in place, keeping its ID stable -- so
// re-opening a saved workflow on the canvas and saving edits updates it
// rather than creating a duplicate. Every workflow (seeded or
// user-composed) lives in c.user (see Workflows' doc comment), so this
// works uniformly on both -- no built-in special case.
func (c *CompositionService) UpdateWorkflow(id, label, description string, nodes []composition.Node, edges []composition.Edge) (composition.Workflow, error) {
	if strings.TrimSpace(label) == "" {
		return composition.Workflow{}, fmt.Errorf("a workflow needs a label")
	}
	if len(nodes) == 0 {
		return composition.Workflow{}, fmt.Errorf("a workflow needs at least one node")
	}

	resolved, err := composition.ResolveNodeDefaults(nodes)
	if err != nil {
		return composition.Workflow{}, err
	}

	c.mu.Lock()
	idx := -1
	for i, wf := range c.user {
		if wf.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return composition.Workflow{}, fmt.Errorf("no workflow with id %q", id)
	}

	if err := composition.ValidateGraph(resolved, edges, c.user[idx].Attributes); err != nil {
		c.mu.Unlock()
		return composition.Workflow{}, err
	}

	wf := composition.Workflow{
		ID:          id,
		Label:       label,
		Description: description,
		Nodes:       resolved,
		Edges:       edges,
		Attributes:  c.user[idx].Attributes,
		// Carried forward, not reset to false: BuiltIn is purely
		// informational now (docs/SPEC.md §2.2's Update note) -- editing
		// a seeded example doesn't stop it having started as one.
		BuiltIn: c.user[idx].BuiltIn,
	}
	c.user[idx] = wf
	c.mu.Unlock()

	c.persist()
	c.notifySyncer()
	return wf, nil
}

// DeleteWorkflow removes a workflow -- seeded or user-composed, both
// live in c.user (see Workflows' doc comment), no built-in special case.
func (c *CompositionService) DeleteWorkflow(id string) error {
	c.mu.Lock()
	idx := -1
	for i, wf := range c.user {
		if wf.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return fmt.Errorf("no workflow with id %q", id)
	}
	c.user = append(c.user[:idx], c.user[idx+1:]...)
	c.mu.Unlock()

	c.persist()
	c.notifySyncer()
	return nil
}

func (c *CompositionService) RunWorkflow(id string) (string, error) {
	for _, wf := range c.Workflows() {
		if wf.ID == id {
			return composition.ExecuteWorkflow(wf.Nodes, wf.Edges, wf.Attributes)
		}
	}
	return "", fmt.Errorf("unknown workflow: %s", id)
}

func (c *CompositionService) persist() {
	c.mu.Lock()
	user := make([]composition.Workflow, len(c.user))
	copy(user, c.user)
	c.mu.Unlock()

	data, err := json.Marshal(user)
	if err != nil {
		return
	}
	_ = c.store.Set(workflowsKey, string(data))
}

// restore loads persisted workflows, or -- on a genuinely fresh install,
// nothing ever persisted -- seeds c.user with the two example workflows
// composition.BuiltInWorkflows() defines. Seeded, not eagerly persisted:
// if the app closes before any real edit happens, re-seeding identically
// next launch is harmless (nothing was ever changed to lose); the moment
// any real mutation occurs (including deleting a seed), persist() below
// makes it real, and this early-return path never fires again. This is
// the one place BuiltInWorkflows() is still called -- see Workflows'
// doc comment for why every other read goes through c.user alone.
func (c *CompositionService) restore() {
	raw, ok := c.store.Get(workflowsKey).(string)
	if !ok || raw == "" {
		c.mu.Lock()
		c.user = composition.BuiltInWorkflows()
		c.mu.Unlock()
		return
	}
	var user []composition.Workflow
	if err := json.Unmarshal([]byte(raw), &user); err != nil {
		return
	}
	c.mu.Lock()
	c.user = user
	c.mu.Unlock()
}

// newWorkflowID derives a readable, collision-resistant ID from the
// workflow's label (e.g. "My Workflow" -> "my-workflow-a1b2c3") --
// stable/debuggable, unlike an opaque UUID, while the random suffix
// keeps two same-named workflows from colliding.
func newWorkflowID(label string) string {
	slug := nonAlnum.ReplaceAllString(strings.ToLower(strings.TrimSpace(label)), "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		slug = "workflow"
	}
	suffix := make([]byte, 3)
	_, _ = rand.Read(suffix)
	return slug + "-" + hex.EncodeToString(suffix)
}
