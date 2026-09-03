package configuresvc

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/adapters/shellenv"
	"github.com/alicoding/mill/internal/contract"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/execenv"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/entitystore"
	"github.com/alicoding/mill/internal/services/seeding"
)

// execEnvDescriptor is ExecEnv's entitystore.Descriptor (goal 0165):
// the small per-kind shape Create/Update/Delete/reconcile/Reset/
// Restorable/Restore all key off, replacing what used to be ~10
// hand-copied methods.
var execEnvDescriptor = entitystore.Descriptor[execenv.ExecEnv]{
	Label:     "execution environment",
	GetID:     func(e execenv.ExecEnv) string { return e.ID },
	IsBuiltIn: func(e execenv.ExecEnv) bool { return e.BuiltIn },
	GetSeed:   func(e execenv.ExecEnv) seedorigin.Origin { return e.Seed },
	SetSeed:   func(e execenv.ExecEnv, s seedorigin.Origin) execenv.ExecEnv { e.Seed = s; return e },
	StampNew: func(e execenv.ExecEnv, now time.Time) execenv.ExecEnv {
		e.CreatedAt, e.UpdatedAt = now, now
		return e
	},
	Upgrade: upgradeExecEnvToGolden,
	BuiltIn: execenv.BuiltIn,
}

// upgradeExecEnvToGolden replaces existing's content with golden's,
// preserving existing's identity (ID/CreatedAt) -- shared by
// reconcileBuiltInExecEnvs' upgrade branch and ResetExecEnvToSeed via
// execEnvDescriptor.Upgrade.
func upgradeExecEnvToGolden(existing, golden execenv.ExecEnv, now time.Time) execenv.ExecEnv {
	golden.CreatedAt = existing.CreatedAt
	golden.UpdatedAt = now
	golden.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
	return golden
}

// CaptureShellPath returns the user's real login-shell $PATH -- the
// ExecEnv form's "Capture from my shell" affordance (ADR-0026's
// Amendment: determinism through materialization; the captured value
// lands in the stored, visible, editable Env, never re-derived at run
// time). A plain read with no side effects; the frontend decides what
// to do with the value (upsert its PATH row).
func (c *ConfigureService) CaptureShellPath() (string, error) {
	return shellenv.CapturePath()
}

// execEnvsKey mirrors mcpServersKey/listsKey's shape (configureservice.go/
// configuremcpserver.go): one atomic JSON blob, same settings.json
// file. In its own file (not appended to configureservice.go) to keep
// that file under CLAUDE.md's 500-line convention -- same reasoning
// configuremcpserver.go's own doc comment gives.
const execEnvsKey = "configure-execenvs"

// resolveExecEnv implements composition.go's lookupExecEnvFn seam
// (codeexec.go). Unexported, so Wails never binds it as a callable
// frontend method -- Go-internal wiring only, same as
// resolveHTTPRequest/resolveList/resolveMCPServer. Env is resolved
// through the same vault-reference path resolveMCPServerEnv established
// (vaultref.go's resolveVaultRefEnv, goal 0203 S1) -- a code-execution
// node is a non-MCP consumer of a stored credential, closing the gap
// where "vault:" only worked inside an MCP server's own Env.
func (c *ConfigureService) resolveExecEnv(id string, run composition.SecretAccessRun) (composition.ResolvedExecEnv, error) {
	c.mu.Lock()
	var found *execenv.ExecEnv
	for i := range c.execEnvs {
		if c.execEnvs[i].ID == id {
			found = &c.execEnvs[i]
			break
		}
	}
	c.mu.Unlock()
	if found == nil {
		return composition.ResolvedExecEnv{}, fmt.Errorf("no execution environment with id %q", id)
	}

	actx := secretaudit.AccessContext{Context: secretaudit.ContextExecEnv, RunID: run.RunID, WorkflowID: run.WorkflowID}
	env, err := c.resolveVaultRefEnv("execution environment", found.Label, found.Env, actx)
	if err != nil {
		return composition.ResolvedExecEnv{}, err
	}
	return composition.ResolvedExecEnv{
		Shell: string(found.Shell), ProfileMode: string(found.ProfileMode), Dir: found.Dir, Env: env, Label: found.Label,
	}, nil
}

// --- Execution Environments ---

func (c *ConfigureService) ExecEnvs() []execenv.ExecEnv {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]execenv.ExecEnv, len(c.execEnvs))
	copy(out, c.execEnvs)
	return out
}

// execEnvExistsLocked reports whether id names a real local ExecEnv --
// callers must hold c.mu. ImportExecEnv's own create-vs-update check
// (this file's own export/import section, below).
func (c *ConfigureService) execEnvExistsLocked(id string) bool {
	for _, e := range c.execEnvs {
		if e.ID == id {
			return true
		}
	}
	return false
}

func (c *ConfigureService) CreateExecEnv(label string, shell execenv.Shell, profileMode execenv.ProfileMode, dir string, env []string) (execenv.ExecEnv, error) {
	return c.createExecEnvWithID(seeding.NewSlugID(label, "execenv"), label, shell, profileMode, dir, env)
}

// createExecEnvWithID is CreateExecEnv's own logic, parameterized on
// the new environment's id -- the seam ImportExecEnv uses to preserve a
// caller-supplied id (ADR-0036 decision 3).
func (c *ConfigureService) createExecEnvWithID(id, label string, shell execenv.Shell, profileMode execenv.ProfileMode, dir string, env []string) (execenv.ExecEnv, error) {
	now := time.Now()
	e := execenv.ExecEnv{
		ID: id, Label: label,
		Shell: shell, ProfileMode: profileMode, Dir: dir, Env: env,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := execenv.Validate(e); err != nil {
		return execenv.ExecEnv{}, err
	}

	if err := entitystore.Insert(&c.mu, &c.execEnvs, c.persistExecEnvs, execEnvDescriptor, e); err != nil {
		return execenv.ExecEnv{}, err
	}
	dataevent.Emit("execenv", e.ID) // goal 0017: live-sync every open surface
	return e, nil
}

func (c *ConfigureService) UpdateExecEnv(id, label string, shell execenv.Shell, profileMode execenv.ProfileMode, dir string, env []string) (execenv.ExecEnv, error) {
	e := execenv.ExecEnv{ID: id, Label: label, Shell: shell, ProfileMode: profileMode, Dir: dir, Env: env}
	if err := execenv.Validate(e); err != nil {
		return execenv.ExecEnv{}, err
	}

	updated, err := entitystore.Update(&c.mu, &c.execEnvs, c.persistExecEnvs, execEnvDescriptor, id, func(existing execenv.ExecEnv) (execenv.ExecEnv, error) {
		// BuiltIn survives an edit (never authorable from this RPC) --
		// same "carried forward from the existing record" reasoning
		// every other UpdateXxx in this package already applies.
		// CreatedAt is preserved from storage, never trusted from the
		// wire; UpdatedAt always advances on a real update.
		e.BuiltIn = existing.BuiltIn
		e.CreatedAt = existing.CreatedAt
		e.UpdatedAt = time.Now()
		e.Seed = existing.Seed.Touch() // docs/goals/0037 item 2
		return e, nil
	})
	if err != nil {
		return execenv.ExecEnv{}, err
	}
	dataevent.Emit("execenv", updated.ID) // goal 0017: live-sync every open surface
	return updated, nil
}

func (c *ConfigureService) DeleteExecEnv(id string) error {
	if err := c.refIntegrityError("execenv", "execution environment", id); err != nil {
		return err
	}
	// A deleted built-in gets a tombstone so top-up seeding never
	// resurrects it -- same discipline every other Delete* in this
	// package applies. Removal and tombstone must succeed together
	// (docs/goals/0025 item 2).
	recordTombstone := func(id string) error { return seeding.RecordTombstone(c.store, id) }
	clearTombstone := func(id string) error { return seeding.ClearTombstone(c.store, id) }
	restore, err := entitystore.DeleteRecoverable(&c.mu, &c.execEnvs, c.persistExecEnvs, recordTombstone, clearTombstone, execEnvDescriptor, id)
	if err != nil {
		return err
	}
	c.undo.remember("execenv", id, restore)
	dataevent.Emit("execenv", id) // goal 0017: live-sync every open surface
	return nil
}

// --- export/import (configureservice_export.go's pattern, kept here
// since this whole entity lives in one file per the recipe) ---

// Schema/ID follow ADR-0036 decision 3's uniform import rule
// (configureservice_export.go's own header comment carries the full
// statement); this family implements it here rather than there since
// the whole entity lives in one file per the recipe.
type exportedExecEnv struct {
	Schema      string              `json:"schema"`
	ID          string              `json:"id,omitempty"`
	Label       string              `json:"label"`
	Shell       execenv.Shell       `json:"shell"`
	ProfileMode execenv.ProfileMode `json:"profileMode"`
	Dir         string              `json:"dir"`
	Env         []string            `json:"env"`
}

func (c *ConfigureService) ExportExecEnv(id string) (string, error) {
	c.mu.Lock()
	var e execenv.ExecEnv
	found := false
	for _, entry := range c.execEnvs {
		if entry.ID == id {
			e = entry
			found = true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return "", fmt.Errorf("no execution environment with id %q", id)
	}

	data, err := json.MarshalIndent(exportedExecEnv{Schema: contract.SchemaID("execenv"), ID: e.ID, Label: e.Label, Shell: e.Shell, ProfileMode: e.ProfileMode, Dir: e.Dir, Env: e.Env}, "", "  ")
	if err != nil {
		return "", fmt.Errorf("export execution environment: %w", err)
	}
	return string(data), nil
}

func (c *ConfigureService) ImportExecEnv(jsonData string) (execenv.ExecEnv, error) {
	var in exportedExecEnv
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return execenv.ExecEnv{}, fmt.Errorf("import execution environment: invalid JSON: %w", err)
	}
	if err := contract.ValidateImportSchema("execenv", in.Schema); err != nil {
		return execenv.ExecEnv{}, fmt.Errorf("import execution environment: %w", err)
	}

	exists := func(id string) bool {
		c.mu.Lock()
		defer c.mu.Unlock()
		return c.execEnvExistsLocked(id)
	}
	return entitystore.DispatchImport(exists, in.ID,
		func() (execenv.ExecEnv, error) {
			return c.UpdateExecEnv(in.ID, in.Label, in.Shell, in.ProfileMode, in.Dir, in.Env)
		},
		func() (execenv.ExecEnv, error) {
			return c.createExecEnvWithID(in.ID, in.Label, in.Shell, in.ProfileMode, in.Dir, in.Env)
		},
		func() (execenv.ExecEnv, error) {
			return c.CreateExecEnv(in.Label, in.Shell, in.ProfileMode, in.Dir, in.Env)
		},
	)
}

// --- persistence ---

func (c *ConfigureService) persistExecEnvs() error {
	return entitystore.Persist(&c.mu, &c.execEnvs, c.store, execEnvsKey, execEnvDescriptor)
}

func (c *ConfigureService) restoreExecEnvs() {
	entitystore.Load(&c.mu, &c.execEnvs, c.store, execEnvsKey)
}
