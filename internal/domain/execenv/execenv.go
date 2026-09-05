// Package execenv holds the core-domain shape of an Execution
// Environment (docs/adr/0026, ADR-0026's Amendment, docs/SPEC.md §6): a
// reusable (1:many), Configure-authored, pinned shell/dir/env a
// code-execution workflow node resolves by ID to know exactly what it's
// about to run inside -- ADR-0026's "materialize, don't inherit"
// principle applied to environments, the same reason a Node's Config is
// always fully resolved rather than left to ambient defaults
// (internal/domain/composition's own doc comment makes the identical
// argument for a step's config). Per CLAUDE.md's core-domain rule, the
// shape and its validation stay hand-written -- no library has an
// opinion on Mill's own environment model. Mirrors
// internal/domain/mcpserver's shape (a reusable, Configure-authored
// entity whose Env may carry a "vault:<id>" reference, resolved at
// spawn time -- goal 0203 S1) more closely than internal/domain/
// httprequest's own AuthType/keychain-backed credential concept, which
// Dir/Env have neither of.
package execenv

import (
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// Shell is a closed, typed choice (ADR-0026's Amendment: "Shell becomes
// a typed choice (zsh/bash/sh), not free argv") -- internal/domain/
// composition/codeexec.go resolves each to its real absolute-path
// binary + the correct no-rc/login flags for ProfileMode, researched
// directly against zsh(1)/bash(1) (see codeexec.go's own doc comment
// for the man-page citations), not assumed.
type Shell string

const (
	ShellZsh  Shell = "zsh"
	ShellBash Shell = "bash"
	ShellSh   Shell = "sh"
)

// ProfileMode picks between a deterministic, rc-free run (the fail-safe
// default per ADR-0026's Amendment) and one that sources the user's own
// shell profile for terminal parity, at the cost of determinism.
type ProfileMode string

const (
	// ProfileClean sources no shell startup files at all -- only the
	// ExecEnv's own explicit Env is visible to the child process.
	// ADR-0026's Amendment: "clean (no profiles; only the stored env --
	// deterministic; DEFAULT, fail-safe)".
	ProfileClean ProfileMode = "clean"
	// ProfileLogin sources the shell's login/profile startup files
	// (.zprofile/.bash_profile/etc) in addition to the ExecEnv's own
	// Env -- "terminal parity, less deterministic" per the Amendment.
	ProfileLogin ProfileMode = "login"
)

// TempDirSentinel is a special Dir value meaning "mint a fresh,
// Mill-owned temp directory for this one run" (codeexec.go resolves it
// via os.MkdirTemp at execution time) rather than a real, pinned path.
// A literal, documented sentinel rather than the empty string: Validate
// below requires Dir non-empty (SPEC §6's "a workflow references a
// declared environment, Mill never infers one" -- an empty Dir would
// silently fall through to procexec.Spec's own ambient-cwd-inheritance
// default, exactly what ADR-0026's "materialize, don't inherit"
// principle exists to prevent), so the "no fixed dir, mint one per run"
// case needs its own explicit, non-empty marker instead of overloading
// the zero value.
const TempDirSentinel = "<mill-temp>"

// ExecEnv is one reusable, named execution environment -- a
// code-execution workflow node resolves envId into this at run time
// (composition.ResolvedExecEnv, codeexec.go's injected SetExecEnvLookup
// seam, same shape as ResolvedMCPServer/ResolvedList).
type ExecEnv struct {
	ID          string
	Label       string
	Shell       Shell
	ProfileMode ProfileMode
	// Dir is the process's working directory -- a real absolute path,
	// or TempDirSentinel (above) to mint a fresh temp dir per run.
	// Never empty (Validate rejects that) -- SPEC §6's pinned-cwd
	// requirement, made a compile-time-adjacent guarantee rather than a
	// convention every caller has to remember.
	Dir string
	// Env is the child process's exact environment, KEY=VALUE per
	// entry -- explicit-only, never merged with Mill's own ambient
	// environment (procexec.Spec.Env's own doc comment: "a nil Env
	// falls back to... the *calling* process's real environment,
	// which is exactly the inheritance ADR-0026's... principle exists
	// to avoid"). Empty is legal (codeexec.go substitutes a minimal
	// default PATH so the shell can still resolve external commands),
	// distinct from nil only at the Go-type level, not semantically. A
	// value of the form "vault:<entry-id>" (vaultref.Parse, goal 0203
	// S1) is resolved to that vault entry's password at run time, never
	// written to disk in resolved form -- mirrors mcpserver.MCPServer.
	// Env's identical convention.
	Env []string
	// EnvironmentID optionally names an Environment (goal 0306 S5)
	// whose variables are added to this shell's own. The Environment's
	// variables are materialized FIRST and this ExecEnv's own Env
	// entries win on a shared key -- the base-plus-override shape the
	// API clients this borrows from converged on, so one shared
	// environment can be pointed at by several shells without any of
	// them losing the entry it sets itself. Empty (every ExecEnv
	// written before this field existed) means exactly today's
	// behavior. A secret variable arrives here already resolved, the
	// same way a "vault:" entry in Env does.
	EnvironmentID string `json:"EnvironmentID,omitempty"`
	// BuiltIn marks a seeded example ExecEnv (BuiltIn() below) --
	// purely informational, same as httprequest.HTTPRequest.BuiltIn/
	// mcpserver.MCPServer.BuiltIn/decision.Decision.BuiltIn/
	// list.List.BuiltIn: drives a "built-in" badge only, never gates
	// Edit/Delete.
	BuiltIn bool
	// CreatedAt/UpdatedAt are system-managed audit timestamps (SPEC.md
	// §3.2.2's reserved-column pattern), stamped server-side at every
	// persisted mutation (ConfigureService), never trusted from the
	// wire. Zero value means pre-timestamp data -- migration-free.
	CreatedAt time.Time
	UpdatedAt time.Time
	// Seed is this ExecEnv's seed provenance (docs/goals/0037) -- zero
	// value means "not of seed origin," migration-free. See
	// composition.Workflow.Seed's doc comment for the full reasoning.
	Seed seedorigin.Origin
}

// Validate checks an ExecEnv is well-formed before it's persisted --
// same "never store an unconfigured/invalid value" discipline every
// other Configure entity's own Validate already applies.
func Validate(e ExecEnv) error {
	if strings.TrimSpace(e.Label) == "" {
		return fmt.Errorf("an execution environment needs a label")
	}
	switch e.Shell {
	case ShellZsh, ShellBash, ShellSh:
	default:
		return fmt.Errorf("unknown shell %q -- must be one of zsh, bash, sh", e.Shell)
	}
	switch e.ProfileMode {
	case ProfileClean, ProfileLogin:
	default:
		return fmt.Errorf("unknown profile mode %q -- must be clean or login", e.ProfileMode)
	}
	if strings.TrimSpace(e.Dir) == "" {
		return fmt.Errorf("an execution environment needs a working directory -- use %q to mint a fresh temp directory per run", TempDirSentinel)
	}
	return nil
}
