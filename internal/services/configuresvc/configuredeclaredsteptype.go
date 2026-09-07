package configuresvc

import (
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/declaredsteptype"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/entitystore"
	"github.com/alicoding/mill/internal/services/seeding"
)

// declaredStepTypeDescriptor is DeclaredStepType's entitystore.
// Descriptor (goal 0165): the small per-kind shape Create/Update/
// Delete/reconcile all key off, replacing what used to be ~8
// hand-copied methods (this kind has no Reset/Restorable/Restore
// RPCs, unlike the other six Configure entities).
var declaredStepTypeDescriptor = entitystore.Descriptor[declaredsteptype.DeclaredStepType]{
	Label:     "declared step type",
	GetID:     func(d declaredsteptype.DeclaredStepType) string { return d.ID },
	IsBuiltIn: func(d declaredsteptype.DeclaredStepType) bool { return d.BuiltIn },
	GetSeed:   func(d declaredsteptype.DeclaredStepType) seedorigin.Origin { return d.Seed },
	SetSeed: func(d declaredsteptype.DeclaredStepType, o seedorigin.Origin) declaredsteptype.DeclaredStepType {
		d.Seed = o
		return d
	},
	StampNew: func(d declaredsteptype.DeclaredStepType, now time.Time) declaredsteptype.DeclaredStepType {
		d.CreatedAt, d.UpdatedAt = now, now
		return d
	},
	Upgrade: upgradeDeclaredStepTypeToGolden,
	BuiltIn: declaredsteptype.BuiltIn,
}

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

	if err := entitystore.Insert(&c.mu, &c.declaredStepTypes, c.persistDeclaredStepTypes, declaredStepTypeDescriptor, d); err != nil {
		return declaredsteptype.DeclaredStepType{}, err
	}
	dataevent.Emit("steptype", d.ID)
	return d, nil
}

func (c *ConfigureService) UpdateDeclaredStepType(id, label, description string, paletteGroup declaredsteptype.PaletteGroup, engine declaredsteptype.Engine, requestID, mcpServerID, toolName, workflowID string, pinnedConfig map[string]string, hiddenFields []string) (declaredsteptype.DeclaredStepType, error) {
	updated, err := entitystore.Update(&c.mu, &c.declaredStepTypes, c.persistDeclaredStepTypes, declaredStepTypeDescriptor, id, func(existing declaredsteptype.DeclaredStepType) (declaredsteptype.DeclaredStepType, error) {
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
		return d, nil
	})
	if err != nil {
		return declaredsteptype.DeclaredStepType{}, err
	}
	dataevent.Emit("steptype", updated.ID)
	return updated, nil
}

func (c *ConfigureService) DeleteDeclaredStepType(id string) error {
	// A workflow referencing this id keeps its (now-dangling) NodeTypeID
	// -- the same dangling-RefKind behavior every other Configure entity
	// delete already has; real reference-integrity handling is goal
	// 0046's own scope, not duplicated here (no refIntegrityError call,
	// unlike every sibling Delete*).
	announce := func(id string) { dataevent.Emit("steptype", id) }
	return deleteEntity(c, "steptype", &c.declaredStepTypes, c.persistDeclaredStepTypes, declaredStepTypeDescriptor, nil,
		func(d declaredsteptype.DeclaredStepType) string { return d.Label }, announce, id)
}

// --- persistence ---

func (c *ConfigureService) persistDeclaredStepTypes() error {
	return entitystore.Persist(&c.mu, &c.declaredStepTypes, c.store, declaredStepTypesKey, declaredStepTypeDescriptor)
}

func (c *ConfigureService) restoreDeclaredStepTypes() {
	entitystore.Load(&c.mu, &c.declaredStepTypes, c.store, declaredStepTypesKey)
}
