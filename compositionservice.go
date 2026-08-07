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
// hotkeyBindingsKey (hotkeyservice.go): one atomic read/write, sharing
// the same settings.json file rather than a second store/file. This is
// persistence for a workflow's authored *definition* (which steps, what
// order, what config) -- a separate, already-settled concern from
// SPEC.md §7's still-open question of persisting/resuming a *running*
// workflow's execution state, which this does not touch or presuppose.
const workflowsKey = "composition-workflows"

var nonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

// CompositionService is the Wails-facing layer over the composition
// domain package -- it holds no domain logic of its own (that's
// internal/domain/composition), only the state and persistence a
// stateless package can't own: user-composed workflows, mirroring
// HotkeyService's already-proven shape (hotkeyservice.go) rather than
// inventing a new one. See docs/SPEC.md §3's `UX: PROTOTYPE` entry for
// what this is testing.
type CompositionService struct {
	mu    sync.Mutex
	store settings.Store
	user  []composition.Workflow
}

func NewCompositionService(store settings.Store) *CompositionService {
	c := &CompositionService{store: store}
	c.restore()
	return c
}

func (c *CompositionService) NodeTypes() []composition.NodeType {
	return composition.NodeTypes()
}

// Workflows returns every built-in workflow followed by every
// user-composed one, in creation order -- a stable, predictable order
// for the UI rather than Go's randomized map iteration.
func (c *CompositionService) Workflows() []composition.Workflow {
	c.mu.Lock()
	defer c.mu.Unlock()

	out := composition.BuiltInWorkflows()
	out = append(out, c.user...)
	return out
}

// CreateWorkflow composes and configures a new workflow in one step, per
// SPEC.md §3: ResolveStepDefaults validates every step's node type and
// fills in any missing config with that field's default, so the stored
// workflow is never partially configured.
func (c *CompositionService) CreateWorkflow(label, description string, steps []composition.Step) (composition.Workflow, error) {
	if strings.TrimSpace(label) == "" {
		return composition.Workflow{}, fmt.Errorf("a workflow needs a label")
	}
	if len(steps) == 0 {
		return composition.Workflow{}, fmt.Errorf("a workflow needs at least one step")
	}

	resolved, err := composition.ResolveStepDefaults(steps)
	if err != nil {
		return composition.Workflow{}, err
	}

	wf := composition.Workflow{
		ID:          newWorkflowID(label),
		Label:       label,
		Description: description,
		Steps:       resolved,
		BuiltIn:     false,
	}

	c.mu.Lock()
	c.user = append(c.user, wf)
	c.mu.Unlock()

	c.persist()
	return wf, nil
}

// DeleteWorkflow removes a user-composed workflow. Built-in workflows
// aren't in c.user at all, so a caller can never delete one -- no
// special-case check needed, the ID space is naturally disjoint.
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
		return fmt.Errorf("no user-composed workflow with id %q (built-in workflows can't be deleted)", id)
	}
	c.user = append(c.user[:idx], c.user[idx+1:]...)
	c.mu.Unlock()

	c.persist()
	return nil
}

func (c *CompositionService) RunWorkflow(id string) (string, error) {
	for _, wf := range c.Workflows() {
		if wf.ID == id {
			return composition.ExecuteWorkflow(wf.Steps)
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

func (c *CompositionService) restore() {
	raw, ok := c.store.Get(workflowsKey).(string)
	if !ok || raw == "" {
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
