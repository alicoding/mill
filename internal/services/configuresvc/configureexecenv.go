package configuresvc

import (
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/shellenv"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/execenv"
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

func (c *ConfigureService) CreateExecEnv(label string, shell execenv.Shell, profileMode execenv.ProfileMode, dir string, env []string) (execenv.ExecEnv, error) {
	e := execenv.ExecEnv{
		ID: seeding.NewSlugID(label, "execenv"), Label: label,
		Shell: shell, ProfileMode: profileMode, Dir: dir, Env: env,
	}
	if err := execenv.Validate(e); err != nil {
		return execenv.ExecEnv{}, err
	}

	c.mu.Lock()
	c.execEnvs = append(c.execEnvs, e)
	c.mu.Unlock()

	c.persistExecEnvs()
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
	// UpdateXxx in this package already applies.
	e.BuiltIn = c.execEnvs[idx].BuiltIn
	c.execEnvs[idx] = e
	c.mu.Unlock()

	c.persistExecEnvs()
	return e, nil
}

func (c *ConfigureService) DeleteExecEnv(id string) error {
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
	wasBuiltIn := c.execEnvs[idx].BuiltIn
	c.execEnvs = append(c.execEnvs[:idx], c.execEnvs[idx+1:]...)
	c.mu.Unlock()

	// A deleted built-in gets a tombstone so top-up seeding never
	// resurrects it (topUpBuiltInExecEnvs, configureservice_builtin.go)
	// -- same discipline every other Delete* in this package applies.
	if wasBuiltIn {
		seeding.RecordTombstone(c.store, id)
	}
	c.persistExecEnvs()
	return nil
}

// --- export/import (configureservice_export.go's pattern, kept here
// since this whole entity lives in one file per the recipe) ---

type exportedExecEnv struct {
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

	data, err := json.MarshalIndent(exportedExecEnv{Label: e.Label, Shell: e.Shell, ProfileMode: e.ProfileMode, Dir: e.Dir, Env: e.Env}, "", "  ")
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
	return c.CreateExecEnv(in.Label, in.Shell, in.ProfileMode, in.Dir, in.Env)
}

// --- persistence ---

func (c *ConfigureService) persistExecEnvs() {
	c.mu.Lock()
	execEnvs := make([]execenv.ExecEnv, len(c.execEnvs))
	copy(execEnvs, c.execEnvs)
	c.mu.Unlock()

	data, err := json.Marshal(execEnvs)
	if err != nil {
		return
	}
	_ = c.store.Set(execEnvsKey, string(data))
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
