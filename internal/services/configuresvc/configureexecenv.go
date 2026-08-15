package configuresvc

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/shellenv"
	"github.com/alicoding/mill/internal/contract"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/execenv"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

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
// resolveHTTPRequest/resolveList/resolveMCPServer.
func (c *ConfigureService) resolveExecEnv(id string) (composition.ResolvedExecEnv, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, e := range c.execEnvs {
		if e.ID == id {
			return composition.ResolvedExecEnv{
				Shell: string(e.Shell), ProfileMode: string(e.ProfileMode), Dir: e.Dir, Env: e.Env,
			}, nil
		}
	}
	return composition.ResolvedExecEnv{}, fmt.Errorf("no execution environment with id %q", id)
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

	c.mu.Lock()
	c.execEnvs = append(c.execEnvs, e)
	c.mu.Unlock()

	if err := c.persistExecEnvs(); err != nil {
		c.mu.Lock()
		for i, existing := range c.execEnvs {
			if existing.ID == e.ID {
				c.execEnvs = append(c.execEnvs[:i], c.execEnvs[i+1:]...)
				break
			}
		}
		c.mu.Unlock()
		return execenv.ExecEnv{}, fmt.Errorf("save execution environment: %w", err)
	}
	dataevent.Emit("execenv", e.ID) // goal 0017: live-sync every open surface
	return e, nil
}

func (c *ConfigureService) UpdateExecEnv(id, label string, shell execenv.Shell, profileMode execenv.ProfileMode, dir string, env []string) (execenv.ExecEnv, error) {
	e := execenv.ExecEnv{ID: id, Label: label, Shell: shell, ProfileMode: profileMode, Dir: dir, Env: env}
	if err := execenv.Validate(e); err != nil {
		return execenv.ExecEnv{}, err
	}

	c.mu.Lock()
	idx := -1
	for i, existing := range c.execEnvs {
		if existing.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return execenv.ExecEnv{}, fmt.Errorf("no execution environment with id %q", id)
	}
	// BuiltIn survives an edit (never authorable from this RPC) -- same
	// "carried forward from the existing record" reasoning every other
	// UpdateXxx in this package already applies. CreatedAt is preserved
	// from storage, never trusted from the wire; UpdatedAt always
	// advances on a real update.
	e.BuiltIn = c.execEnvs[idx].BuiltIn
	e.CreatedAt = c.execEnvs[idx].CreatedAt
	e.UpdatedAt = time.Now()
	e.Seed = c.execEnvs[idx].Seed.Touch() // docs/goals/0037 item 2
	previous := c.execEnvs[idx]
	c.execEnvs[idx] = e
	c.mu.Unlock()

	if err := c.persistExecEnvs(); err != nil {
		c.mu.Lock()
		for i, existing := range c.execEnvs {
			if existing.ID == id {
				c.execEnvs[i] = previous
				break
			}
		}
		c.mu.Unlock()
		return execenv.ExecEnv{}, fmt.Errorf("save execution environment: %w", err)
	}
	dataevent.Emit("execenv", e.ID) // goal 0017: live-sync every open surface
	return e, nil
}

func (c *ConfigureService) DeleteExecEnv(id string) error {
	if err := c.refIntegrityError("execenv", "execution environment", id); err != nil {
		return err
	}

	c.mu.Lock()
	idx := -1
	for i, e := range c.execEnvs {
		if e.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return fmt.Errorf("no execution environment with id %q", id)
	}
	removed := c.execEnvs[idx]
	wasBuiltIn := removed.BuiltIn
	c.execEnvs = append(c.execEnvs[:idx], c.execEnvs[idx+1:]...)
	c.mu.Unlock()

	// A deleted built-in gets a tombstone so top-up seeding never
	// resurrects it (topUpBuiltInExecEnvs, configureservice_builtin.go)
	// -- same discipline every other Delete* in this package applies.
	// Removal and tombstone must succeed together (docs/goals/0025
	// item 2).
	if wasBuiltIn {
		if err := seeding.RecordTombstone(c.store, id); err != nil {
			c.mu.Lock()
			c.execEnvs = insertExecEnvAt(c.execEnvs, idx, removed)
			c.mu.Unlock()
			return fmt.Errorf("tombstone deleted execution environment %q: %w", id, err)
		}
	}
	if err := c.persistExecEnvs(); err != nil {
		c.mu.Lock()
		c.execEnvs = insertExecEnvAt(c.execEnvs, idx, removed)
		c.mu.Unlock()
		return fmt.Errorf("save execution environment deletion: %w", err)
	}
	dataevent.Emit("execenv", id) // goal 0017: live-sync every open surface
	return nil
}

// insertExecEnvAt reinserts e at idx (clamped to the current length) --
// used to undo DeleteExecEnv's removal when the tombstone or persist
// step that must accompany it fails.
func insertExecEnvAt(envs []execenv.ExecEnv, idx int, e execenv.ExecEnv) []execenv.ExecEnv {
	if idx < 0 || idx > len(envs) {
		idx = len(envs)
	}
	envs = append(envs, execenv.ExecEnv{})
	copy(envs[idx+1:], envs[idx:])
	envs[idx] = e
	return envs
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

	if in.ID != "" {
		c.mu.Lock()
		found := c.execEnvExistsLocked(in.ID)
		c.mu.Unlock()
		if found {
			return c.UpdateExecEnv(in.ID, in.Label, in.Shell, in.ProfileMode, in.Dir, in.Env)
		}
		return c.createExecEnvWithID(in.ID, in.Label, in.Shell, in.ProfileMode, in.Dir, in.Env)
	}
	return c.CreateExecEnv(in.Label, in.Shell, in.ProfileMode, in.Dir, in.Env)
}

// --- persistence ---

func (c *ConfigureService) persistExecEnvs() error {
	c.mu.Lock()
	execEnvs := make([]execenv.ExecEnv, len(c.execEnvs))
	copy(execEnvs, c.execEnvs)
	c.mu.Unlock()

	data, err := json.Marshal(execEnvs)
	if err != nil {
		return fmt.Errorf("marshal execution environments: %w", err)
	}
	if err := c.store.Set(execEnvsKey, string(data)); err != nil {
		return fmt.Errorf("persist execution environments: %w", err)
	}
	return nil
}

func (c *ConfigureService) restoreExecEnvs() {
	raw, ok := c.store.Get(execEnvsKey).(string)
	if !ok || raw == "" {
		return
	}
	var execEnvs []execenv.ExecEnv
	if err := json.Unmarshal([]byte(raw), &execEnvs); err != nil {
		return
	}
	c.mu.Lock()
	c.execEnvs = execEnvs
	c.mu.Unlock()
}
