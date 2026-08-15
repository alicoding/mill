package configuresvc

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/declaredsteptype"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// declaredStepTypesKey mirrors decisionsKey/execEnvsKey's shape
// (configuredecision.go/configureexecenv.go): one atomic JSON blob,
// same settings.json file. In its own file (not appended to
// configureservice.go) to keep that file under CLAUDE.md's 500-line
// convention, same reasoning those two files' own header comments give.
const declaredStepTypesKey = "configure-declared-step-types"

// declaredStepBindings implements composition.go's
// SetDeclaredNodeTypeLookup seam (declaredsteptype.go, ADR-0037):
// converts every locally-stored DeclaredStepType into composition's
// own DeclaredStepBinding shape -- the service-layer bridge between
// the Configure-owned entity and composition's injected seam, same
// role resolveDecision/resolveExecEnv already play for their own
// entities. EngineFields() is merged into BOTH PinnedConfig and
// HiddenFields here (never in the domain package itself, see
// declaredsteptype.go's own doc comment) -- the mechanism that keeps a
// declared type's engine binding fixed rather than merely defaulted.
func (c *ConfigureService) declaredStepBindings() []composition.DeclaredStepBinding {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]composition.DeclaredStepBinding, 0, len(c.declaredStepTypes))
	for _, d := range c.declaredStepTypes {
		pinned := make(map[string]string, len(d.PinnedConfig)+2)
		for k, v := range d.PinnedConfig {
			pinned[k] = v
		}
		hidden := append([]string{}, d.HiddenFields...)
		for k, v := range d.EngineFields() {
			pinned[k] = v
			hidden = append(hidden, k)
		}
		out = append(out, composition.DeclaredStepBinding{
			ID: d.ID, Label: d.Label, Description: d.Description,
			PaletteGroup:     string(d.PaletteGroup),
			EngineNodeTypeID: d.EngineNodeTypeID(),
			PinnedConfig:     pinned, HiddenFields: hidden,
		})
	}
	return out
}

// --- Declared step types ---

func (c *ConfigureService) DeclaredStepTypes() []declaredsteptype.DeclaredStepType {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]declaredsteptype.DeclaredStepType, len(c.declaredStepTypes))
	copy(out, c.declaredStepTypes)
	return out
}

// declaredStepTypeExistsLocked reports whether id names a real local
// DeclaredStepType -- callers must hold c.mu. ImportDeclaredStepType's
// own create-vs-update check (configuredeclaredsteptype_seed.go).
func (c *ConfigureService) declaredStepTypeExistsLocked(id string) bool {
	for _, d := range c.declaredStepTypes {
		if d.ID == id {
			return true
		}
	}
	return false
}

func (c *ConfigureService) CreateDeclaredStepType(label, description string, paletteGroup declaredsteptype.PaletteGroup, engine declaredsteptype.Engine, requestID, mcpServerID, toolName, workflowID string, pinnedConfig map[string]string, hiddenFields []string) (declaredsteptype.DeclaredStepType, error) {
	return c.createDeclaredStepTypeWithID(seeding.NewSlugID(label, "steptype"), label, description, paletteGroup, engine, requestID, mcpServerID, toolName, workflowID, pinnedConfig, hiddenFields)
}

// createDeclaredStepTypeWithID is CreateDeclaredStepType's own logic,
// parameterized on the new declared step type's id -- the seam
// ImportDeclaredStepType uses to preserve a caller-supplied id
// (ADR-0036 decision 3).
func (c *ConfigureService) createDeclaredStepTypeWithID(id, label, description string, paletteGroup declaredsteptype.PaletteGroup, engine declaredsteptype.Engine, requestID, mcpServerID, toolName, workflowID string, pinnedConfig map[string]string, hiddenFields []string) (declaredsteptype.DeclaredStepType, error) {
	now := time.Now()
	d := declaredsteptype.DeclaredStepType{
		ID: id, Label: label, Description: description, PaletteGroup: paletteGroup,
		Engine: engine, RequestID: requestID, MCPServerID: mcpServerID, ToolName: toolName, WorkflowID: workflowID,
		PinnedConfig: pinnedConfig, HiddenFields: hiddenFields,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := declaredsteptype.Validate(d); err != nil {
		return declaredsteptype.DeclaredStepType{}, err
	}

	c.mu.Lock()
	c.declaredStepTypes = append(c.declaredStepTypes, d)
	c.mu.Unlock()

	if err := c.persistDeclaredStepTypes(); err != nil {
		c.mu.Lock()
		for i, existing := range c.declaredStepTypes {
			if existing.ID == d.ID {
				c.declaredStepTypes = append(c.declaredStepTypes[:i], c.declaredStepTypes[i+1:]...)
				break
			}
		}
		c.mu.Unlock()
		return declaredsteptype.DeclaredStepType{}, fmt.Errorf("save declared step type: %w", err)
	}
	dataevent.Emit("steptype", d.ID)
	return d, nil
}

func (c *ConfigureService) UpdateDeclaredStepType(id, label, description string, paletteGroup declaredsteptype.PaletteGroup, engine declaredsteptype.Engine, requestID, mcpServerID, toolName, workflowID string, pinnedConfig map[string]string, hiddenFields []string) (declaredsteptype.DeclaredStepType, error) {
	c.mu.Lock()
	idx := -1
	for i, existing := range c.declaredStepTypes {
		if existing.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return declaredsteptype.DeclaredStepType{}, fmt.Errorf("no declared step type with id %q", id)
	}
	existing := c.declaredStepTypes[idx]
	c.mu.Unlock()

	d := declaredsteptype.DeclaredStepType{
		ID: id, Label: label, Description: description, PaletteGroup: paletteGroup,
		Engine: engine, RequestID: requestID, MCPServerID: mcpServerID, ToolName: toolName, WorkflowID: workflowID,
		PinnedConfig: pinnedConfig, HiddenFields: hiddenFields,
		BuiltIn: existing.BuiltIn,
		// CreatedAt is preserved from the stored entity, never trusted
		// from the wire; UpdatedAt always advances on a real update.
		CreatedAt: existing.CreatedAt,
		UpdatedAt: time.Now(),
		// Modified latch (docs/goals/0037 item 2), same reasoning as
		// decision/execenv's own UpdateXxx.
		Seed: existing.Seed.Touch(),
	}
	if err := declaredsteptype.Validate(d); err != nil {
		return declaredsteptype.DeclaredStepType{}, err
	}

	c.mu.Lock()
	idx = -1
	for i, e := range c.declaredStepTypes {
		if e.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return declaredsteptype.DeclaredStepType{}, fmt.Errorf("no declared step type with id %q", id)
	}
	previous := c.declaredStepTypes[idx]
	c.declaredStepTypes[idx] = d
	c.mu.Unlock()

	if err := c.persistDeclaredStepTypes(); err != nil {
		c.mu.Lock()
		for i, existing := range c.declaredStepTypes {
			if existing.ID == id {
				c.declaredStepTypes[i] = previous
				break
			}
		}
		c.mu.Unlock()
		return declaredsteptype.DeclaredStepType{}, fmt.Errorf("save declared step type: %w", err)
	}
	dataevent.Emit("steptype", d.ID)
	return d, nil
}

func (c *ConfigureService) DeleteDeclaredStepType(id string) error {
	c.mu.Lock()
	idx := -1
	for i, d := range c.declaredStepTypes {
		if d.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return fmt.Errorf("no declared step type with id %q", id)
	}
	removed := c.declaredStepTypes[idx]
	wasBuiltIn := removed.BuiltIn
	c.declaredStepTypes = append(c.declaredStepTypes[:idx], c.declaredStepTypes[idx+1:]...)
	c.mu.Unlock()

	// A workflow referencing this id keeps its (now-dangling) NodeTypeID
	// -- the same dangling-RefKind behavior every other Configure entity
	// delete already has; real reference-integrity handling is goal
	// 0046's own scope, not duplicated here.
	//
	// A deleted built-in gets a tombstone so top-up seeding never
	// resurrects it (reconcileBuiltInDeclaredStepTypes,
	// configuredeclaredsteptype_seed.go) -- same discipline every other
	// Delete* in this package applies. Removal and tombstone must
	// succeed together (docs/goals/0025 item 2).
	if wasBuiltIn {
		if err := seeding.RecordTombstone(c.store, id); err != nil {
			c.mu.Lock()
			c.declaredStepTypes = insertDeclaredStepTypeAt(c.declaredStepTypes, idx, removed)
			c.mu.Unlock()
			return fmt.Errorf("tombstone deleted declared step type %q: %w", id, err)
		}
	}
	if err := c.persistDeclaredStepTypes(); err != nil {
		c.mu.Lock()
		c.declaredStepTypes = insertDeclaredStepTypeAt(c.declaredStepTypes, idx, removed)
		c.mu.Unlock()
		return fmt.Errorf("save declared step type deletion: %w", err)
	}
	dataevent.Emit("steptype", id)
	return nil
}

// insertDeclaredStepTypeAt reinserts d at idx (clamped to the current
// length) -- used to undo DeleteDeclaredStepType's removal when the
// tombstone or persist step that must accompany it fails.
func insertDeclaredStepTypeAt(types []declaredsteptype.DeclaredStepType, idx int, d declaredsteptype.DeclaredStepType) []declaredsteptype.DeclaredStepType {
	if idx < 0 || idx > len(types) {
		idx = len(types)
	}
	types = append(types, declaredsteptype.DeclaredStepType{})
	copy(types[idx+1:], types[idx:])
	types[idx] = d
	return types
}

// --- persistence ---

func (c *ConfigureService) persistDeclaredStepTypes() error {
	c.mu.Lock()
	types := make([]declaredsteptype.DeclaredStepType, len(c.declaredStepTypes))
	copy(types, c.declaredStepTypes)
	c.mu.Unlock()

	data, err := json.Marshal(types)
	if err != nil {
		return fmt.Errorf("marshal declared step types: %w", err)
	}
	if err := c.store.Set(declaredStepTypesKey, string(data)); err != nil {
		return fmt.Errorf("persist declared step types: %w", err)
	}
	return nil
}

func (c *ConfigureService) restoreDeclaredStepTypes() {
	raw, ok := c.store.Get(declaredStepTypesKey).(string)
	if !ok || raw == "" {
		return
	}
	var types []declaredsteptype.DeclaredStepType
	if err := json.Unmarshal([]byte(raw), &types); err != nil {
		return
	}
	c.mu.Lock()
	c.declaredStepTypes = types
	c.mu.Unlock()
}
