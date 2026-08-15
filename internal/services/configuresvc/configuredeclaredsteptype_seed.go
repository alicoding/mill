package configuresvc

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/alicoding/mill/internal/contract"
	"github.com/alicoding/mill/internal/domain/declaredsteptype"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/services/seeding"
)

// reconcileBuiltInDeclaredStepTypes mirrors reconcileBuiltInExecEnvs
// (configureservice_builtin.go) for the seeded example DeclaredStepType
// (docs/goals/0054 slice A). A DeclaredStepType carries no secret, same
// "simpler than the HTTPRequest version" reasoning every sibling
// reconcile already gives.
func (c *ConfigureService) reconcileBuiltInDeclaredStepTypes() {
	tombstones := seeding.LoadTombstones(c.store)
	now := time.Now()
	c.mu.Lock()
	byID := make(map[string]int, len(c.declaredStepTypes))
	for i, d := range c.declaredStepTypes {
		byID[d.ID] = i
	}
	changed := false
	for _, golden := range declaredsteptype.BuiltIn() {
		idx, present := byID[golden.ID]
		if !present {
			if tombstones[golden.ID] {
				continue
			}
			golden.CreatedAt, golden.UpdatedAt = now, now
			c.declaredStepTypes = append(c.declaredStepTypes, golden)
			changed = true
			continue
		}
		existing := c.declaredStepTypes[idx]
		if existing.Seed.SeedRevision == 0 {
			existing.Seed = seedorigin.Origin{SeedRevision: golden.Seed.SeedRevision, Modified: true}
			c.declaredStepTypes[idx] = existing
			changed = true
			continue
		}
		if existing.Seed.Modified {
			continue
		}
		if existing.Seed.SeedRevision < golden.Seed.SeedRevision {
			c.declaredStepTypes[idx] = upgradeDeclaredStepTypeToGolden(existing, golden, now)
			changed = true
		}
	}
	c.mu.Unlock()
	if changed {
		if err := c.persistDeclaredStepTypes(); err != nil {
			slog.Error("failed to reconcile built-in declared step types", "error", err)
		}
	}
}

func upgradeDeclaredStepTypeToGolden(existing, golden declaredsteptype.DeclaredStepType, now time.Time) declaredsteptype.DeclaredStepType {
	golden.CreatedAt = existing.CreatedAt
	golden.UpdatedAt = now
	golden.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
	return golden
}

// reconcileDeclaredStepTypeSeedWorkflow top-ups
// composition.BuiltInWorkflows()' declared-type-consuming entry
// (builtinworkflows_declaredsteptype.go) once this method's own
// declared step types are loaded/reconciled and
// composition.SetDeclaredNodeTypeLookup is wired -- both true by the
// time NewConfigureService calls this, last. See that entry's own doc
// comment for why CompositionService's first pass (inside its own
// constructor, which runs before ConfigureService exists at all)
// cannot see it. CompositionService.ReconcileBuiltIns re-reads
// composition.BuiltInWorkflows() fresh and applies its normal
// insert/upgrade/leave-alone/skip logic, so this is a plain top-up
// call, not a second reconcile implementation.
func (c *ConfigureService) reconcileDeclaredStepTypeSeedWorkflow() {
	c.composition.ReconcileBuiltIns()
}

// --- export/import (configureservice_export.go's pattern, kept here
// since this whole entity lives in its own pair of files per the
// recipe configureexecenv.go already establishes) ---

// exportedDeclaredStepType omits nothing today: unlike Decision's
// WebhookRequestID, every field on DeclaredStepType is itself either
// portable config or a Configure-entity ID re-authored on the far side
// after import, the same "live-referenced by id" semantics every other
// RefKind-carrying export already has (ADR-0037 Decision 3).
type exportedDeclaredStepType struct {
	Schema       string                        `json:"schema"`
	ID           string                        `json:"id,omitempty"`
	Label        string                        `json:"label"`
	Description  string                        `json:"description,omitempty"`
	PaletteGroup declaredsteptype.PaletteGroup `json:"paletteGroup"`
	Engine       declaredsteptype.Engine       `json:"engine"`
	RequestID    string                        `json:"requestId,omitempty"`
	MCPServerID  string                        `json:"mcpServerId,omitempty"`
	ToolName     string                        `json:"toolName,omitempty"`
	WorkflowID   string                        `json:"workflowId,omitempty"`
	PinnedConfig map[string]string             `json:"pinnedConfig,omitempty"`
	HiddenFields []string                      `json:"hiddenFields,omitempty"`
}

func (c *ConfigureService) ExportDeclaredStepType(id string) (string, error) {
	c.mu.Lock()
	var d declaredsteptype.DeclaredStepType
	found := false
	for _, entry := range c.declaredStepTypes {
		if entry.ID == id {
			d = entry
			found = true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return "", fmt.Errorf("no declared step type with id %q", id)
	}

	data, err := json.MarshalIndent(exportedDeclaredStepType{
		Schema: contract.SchemaID("steptype"), ID: d.ID, Label: d.Label, Description: d.Description,
		PaletteGroup: d.PaletteGroup, Engine: d.Engine,
		RequestID: d.RequestID, MCPServerID: d.MCPServerID, ToolName: d.ToolName, WorkflowID: d.WorkflowID,
		PinnedConfig: d.PinnedConfig, HiddenFields: d.HiddenFields,
	}, "", "  ")
	if err != nil {
		return "", fmt.Errorf("export declared step type: %w", err)
	}
	return string(data), nil
}

// ImportDeclaredStepType applies ADR-0036 decision 3's uniform import
// rule (configureservice_export.go's own header comment carries the
// full statement).
func (c *ConfigureService) ImportDeclaredStepType(jsonData string) (declaredsteptype.DeclaredStepType, error) {
	var in exportedDeclaredStepType
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return declaredsteptype.DeclaredStepType{}, fmt.Errorf("import declared step type: invalid JSON: %w", err)
	}
	if err := contract.ValidateImportSchema("steptype", in.Schema); err != nil {
		return declaredsteptype.DeclaredStepType{}, fmt.Errorf("import declared step type: %w", err)
	}

	if in.ID != "" {
		c.mu.Lock()
		found := c.declaredStepTypeExistsLocked(in.ID)
		c.mu.Unlock()
		if found {
			return c.UpdateDeclaredStepType(in.ID, in.Label, in.Description, in.PaletteGroup, in.Engine, in.RequestID, in.MCPServerID, in.ToolName, in.WorkflowID, in.PinnedConfig, in.HiddenFields)
		}
		return c.createDeclaredStepTypeWithID(in.ID, in.Label, in.Description, in.PaletteGroup, in.Engine, in.RequestID, in.MCPServerID, in.ToolName, in.WorkflowID, in.PinnedConfig, in.HiddenFields)
	}
	return c.CreateDeclaredStepType(in.Label, in.Description, in.PaletteGroup, in.Engine, in.RequestID, in.MCPServerID, in.ToolName, in.WorkflowID, in.PinnedConfig, in.HiddenFields)
}
