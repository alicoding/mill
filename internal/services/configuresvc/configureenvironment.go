package configuresvc

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/contract"
	"github.com/alicoding/mill/internal/domain/environment"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/entitystore"
	"github.com/alicoding/mill/internal/services/seeding"
)

// The Environment entity's CRUD, persistence and seed lifecycle (goal
// 0306 S5) -- resolution, the preflight variable-gap check and the
// reference summary live in configureenvironment_resolve.go, which is
// where every read that touches the secret store is, so this file
// stays the plain-data half.

// environmentsKey mirrors execEnvsKey's shape: one atomic JSON blob,
// same settings.json file.
const environmentsKey = "configure-environments"

var environmentDescriptor = entitystore.Descriptor[environment.Environment]{
	Label:     "environment",
	GetID:     func(e environment.Environment) string { return e.ID },
	IsBuiltIn: func(e environment.Environment) bool { return e.BuiltIn },
	GetSeed:   func(e environment.Environment) seedorigin.Origin { return e.Seed },
	SetSeed: func(e environment.Environment, s seedorigin.Origin) environment.Environment {
		e.Seed = s
		return e
	},
	StampNew: func(e environment.Environment, now time.Time) environment.Environment {
		e.CreatedAt, e.UpdatedAt = now, now
		return e
	},
	Upgrade: upgradeEnvironmentToGolden,
	BuiltIn: environment.BuiltIn,
}

// upgradeEnvironmentToGolden replaces existing's content with
// golden's, preserving existing's identity -- shared by
// reconcileBuiltInEnvironments and ResetEnvironmentToSeed.
func upgradeEnvironmentToGolden(existing, golden environment.Environment, now time.Time) environment.Environment {
	golden.CreatedAt = existing.CreatedAt
	golden.UpdatedAt = now
	golden.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
	return golden
}

// --- Environments ---

func (c *ConfigureService) Environments() []environment.Environment {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]environment.Environment, len(c.environments))
	copy(out, c.environments)
	return out
}

// environmentExistsLocked reports whether id names a real local
// Environment -- callers must hold c.mu.
func (c *ConfigureService) environmentExistsLocked(id string) bool {
	for _, e := range c.environments {
		if e.ID == id {
			return true
		}
	}
	return false
}

func (c *ConfigureService) CreateEnvironment(label string, vars []environment.Variable) (environment.Environment, error) {
	return c.createEnvironmentWithID(seeding.NewSlugID(label, "environment"), label, vars)
}

// createEnvironmentWithID is CreateEnvironment's own logic
// parameterized on the new environment's id -- the seam
// ImportEnvironment uses to preserve a caller-supplied id (ADR-0036
// decision 3).
func (c *ConfigureService) createEnvironmentWithID(id, label string, vars []environment.Variable) (environment.Environment, error) {
	now := time.Now()
	e := environment.Environment{ID: id, Label: label, Vars: vars, CreatedAt: now, UpdatedAt: now}
	if err := environment.Validate(e); err != nil {
		return environment.Environment{}, err
	}
	if err := entitystore.Insert(&c.mu, &c.environments, c.persistEnvironments, environmentDescriptor, e); err != nil {
		return environment.Environment{}, err
	}
	dataevent.Emit("environment", e.ID) // goal 0017: live-sync every open surface
	return e, nil
}

func (c *ConfigureService) UpdateEnvironment(id, label string, vars []environment.Variable) (environment.Environment, error) {
	e := environment.Environment{ID: id, Label: label, Vars: vars}
	if err := environment.Validate(e); err != nil {
		return environment.Environment{}, err
	}
	updated, err := entitystore.Update(&c.mu, &c.environments, c.persistEnvironments, environmentDescriptor, id, func(existing environment.Environment) (environment.Environment, error) {
		// BuiltIn and CreatedAt are carried forward from storage, never
		// trusted from the wire; UpdatedAt always advances.
		e.BuiltIn = existing.BuiltIn
		e.CreatedAt = existing.CreatedAt
		e.UpdatedAt = time.Now()
		e.Seed = existing.Seed.Touch() // docs/goals/0037 item 2
		return e, nil
	})
	if err != nil {
		return environment.Environment{}, err
	}
	dataevent.Emit("environment", updated.ID) // goal 0017: live-sync every open surface
	return updated, nil
}

// DeleteEnvironment refuses while a workflow still names this
// environment -- as its per-run default, or through a shell that
// borrows its variables (compositionsvc.WorkflowsReferencing knows
// both, ADR-0040 decision 3).
func (c *ConfigureService) DeleteEnvironment(id string) error {
	if err := c.refIntegrityError("environment", "environment", id); err != nil {
		return err
	}
	if err := c.execEnvsUsingEnvironmentError(id); err != nil {
		return err
	}
	recordTombstone := func(id string) error { return seeding.RecordTombstone(c.store, id) }
	clearTombstone := func(id string) error { return seeding.ClearTombstone(c.store, id) }
	restore, err := entitystore.DeleteRecoverable(&c.mu, &c.environments, c.persistEnvironments, recordTombstone, clearTombstone, environmentDescriptor, id)
	if err != nil {
		return err
	}
	c.undo.remember("environment", id, restore)
	dataevent.Emit("environment", id) // goal 0017: live-sync every open surface
	return nil
}

// execEnvsUsingEnvironmentError is the second half of this entity's
// referential rule: a workflow reference is compositionsvc's to see,
// but an execution environment borrowing these variables lives in this
// service's own data.
func (c *ConfigureService) execEnvsUsingEnvironmentError(id string) error {
	c.mu.Lock()
	var labels []string
	for _, e := range c.execEnvs {
		if e.EnvironmentID == id {
			labels = append(labels, e.Label)
		}
	}
	c.mu.Unlock()
	if len(labels) == 0 {
		return nil
	}
	return fmt.Errorf("environment %q is still used by execution environment(s) %s -- remove the reference before deleting it", id, strings.Join(labels, ", "))
}

// --- seed lifecycle (configureservice_seedlifecycle_more.go's shape,
// kept here since this whole entity lives beside its own descriptor) ---

// ResetEnvironmentToSeed restores a seeded Environment's shipped
// content, via environmentDescriptor.
func (c *ConfigureService) ResetEnvironmentToSeed(id string) (environment.Environment, error) {
	updated, err := entitystore.ResetToSeed(&c.mu, &c.environments, c.persistEnvironments, environmentDescriptor, id)
	if err != nil {
		return environment.Environment{}, err
	}
	dataevent.Emit("environment", id) // goal 0017: live-sync every open surface
	return updated, nil
}

// RestorableEnvironments lists deleted seeds this install can bring
// back.
func (c *ConfigureService) RestorableEnvironments() []environment.Environment {
	return entitystore.Restorable(&c.mu, &c.environments, seeding.LoadTombstones(c.store), environmentDescriptor)
}

// RestoreEnvironment brings one deleted seed back.
func (c *ConfigureService) RestoreEnvironment(id string) (environment.Environment, error) {
	restored, err := entitystore.Restore(&c.mu, &c.environments, c.persistEnvironments, c.store, environmentDescriptor, id)
	if err != nil {
		return environment.Environment{}, err
	}
	dataevent.Emit("environment", id) // goal 0017: live-sync every open surface
	return restored, nil
}

// reconcileBuiltInEnvironments mirrors reconcileBuiltInExecEnvs.
func (c *ConfigureService) reconcileBuiltInEnvironments() {
	tombstones := seeding.LoadTombstones(c.store)
	if _, changed := entitystore.Reconcile(&c.mu, &c.environments, tombstones, environmentDescriptor); changed {
		if err := c.persistEnvironments(); err != nil {
			slog.Error("failed to reconcile built-in Environments", "error", err)
		}
	}
}

// --- export/import ---

type exportedEnvironment struct {
	Schema string                 `json:"schema"`
	ID     string                 `json:"id,omitempty"`
	Label  string                 `json:"label"`
	Vars   []environment.Variable `json:"vars"`
}

func (c *ConfigureService) ExportEnvironment(id string) (string, error) {
	c.mu.Lock()
	var e environment.Environment
	found := false
	for _, entry := range c.environments {
		if entry.ID == id {
			e, found = entry, true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return "", fmt.Errorf("no environment with id %q", id)
	}
	data, err := json.MarshalIndent(exportedEnvironment{Schema: contract.SchemaID("environment"), ID: e.ID, Label: e.Label, Vars: e.Vars}, "", "  ")
	if err != nil {
		return "", fmt.Errorf("export environment: %w", err)
	}
	return string(data), nil
}

func (c *ConfigureService) ImportEnvironment(jsonData string) (environment.Environment, error) {
	var in exportedEnvironment
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return environment.Environment{}, fmt.Errorf("import environment: invalid JSON: %w", err)
	}
	if err := contract.ValidateImportSchema("environment", in.Schema); err != nil {
		return environment.Environment{}, fmt.Errorf("import environment: %w", err)
	}
	exists := func(id string) bool {
		c.mu.Lock()
		defer c.mu.Unlock()
		return c.environmentExistsLocked(id)
	}
	return entitystore.DispatchImport(exists, in.ID,
		func() (environment.Environment, error) { return c.UpdateEnvironment(in.ID, in.Label, in.Vars) },
		func() (environment.Environment, error) {
			return c.createEnvironmentWithID(in.ID, in.Label, in.Vars)
		},
		func() (environment.Environment, error) { return c.CreateEnvironment(in.Label, in.Vars) },
	)
}

// --- persistence ---

func (c *ConfigureService) persistEnvironments() error {
	return entitystore.Persist(&c.mu, &c.environments, c.store, environmentsKey, environmentDescriptor)
}

func (c *ConfigureService) restoreEnvironments() {
	entitystore.Load(&c.mu, &c.environments, c.store, environmentsKey)
}
