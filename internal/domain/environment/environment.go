// Package environment holds the core-domain shape of an Environment
// (docs/SPEC.md §3.5, goal 0306 S5): a named, switchable set of
// variables a run selects instead of editing the request it is about
// to send. A variable is either PLAIN (its Value is the literal text
// substituted for {{key}}) or SECRET (its Value is a reference into
// the secret store -- "vault:<id>" or "<provider>:<source>/<KEY>",
// vaultref's own grammar -- never the secret itself), which is the one
// rule that makes this entity storable in plain settings JSON at all.
//
// Per CLAUDE.md's core-domain rule the shape and its validation stay
// hand-written; mirrors internal/domain/execenv's shape (a reusable,
// Configure-authored entity whose values may name a stored secret,
// resolved at run time) rather than internal/domain/httprequest's
// per-entity credential concept.
package environment

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// KeyPattern is the variable-name grammar: an identifier, so a key can
// never be confused with the interpolation syntax around it and reads
// the same as the shell/CI variable names it stands beside
// (composition.Interpolate rejects anything else as literal text).
var KeyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// ValidKey reports whether k is a well-formed variable name.
func ValidKey(k string) bool { return KeyPattern.MatchString(k) }

// Variable is one entry of an Environment.
type Variable struct {
	Key string
	// Value is the literal substituted for {{Key}} when Secret is
	// false, and a secret-store REFERENCE when Secret is true -- never
	// a secret's own text. An empty reference is legal and means the
	// variable has no value yet; resolution treats it as an empty
	// string, and the entity list says so.
	Value string
	// Secret marks Value as a reference rather than a literal. It also
	// decides which control edits the field and whether a read is
	// audited (secretaudit.ContextEnvironmentVar).
	Secret bool
}

// Environment is one named set of variables.
type Environment struct {
	ID    string
	Label string
	Vars  []Variable
	// BuiltIn marks a seeded example -- purely informational, a badge
	// only, never a gate on Edit/Delete (execenv.ExecEnv.BuiltIn's own
	// convention).
	BuiltIn bool
	// CreatedAt/UpdatedAt are system-managed audit timestamps
	// (SPEC.md §3.2.2), stamped server-side, never trusted from the
	// wire.
	CreatedAt time.Time
	UpdatedAt time.Time
	// Seed is this Environment's seed provenance (docs/goals/0037) --
	// zero value means "not of seed origin," migration-free.
	Seed seedorigin.Origin
}

// Validate checks an Environment is well-formed before it is
// persisted: a label, identifier-shaped keys, and no key twice (two
// entries for one key would make {{key}} resolve by storage order,
// which is not a decision a user made).
func Validate(e Environment) error {
	if strings.TrimSpace(e.Label) == "" {
		return fmt.Errorf("an environment needs a label")
	}
	seen := make(map[string]bool, len(e.Vars))
	for _, v := range e.Vars {
		if !ValidKey(v.Key) {
			return fmt.Errorf("%q is not a usable variable name -- start with a letter or underscore, then letters, digits or underscores", v.Key)
		}
		if seen[v.Key] {
			return fmt.Errorf("this environment already has a variable named %q", v.Key)
		}
		seen[v.Key] = true
	}
	return nil
}

// SecretCount reports how many of e's variables are secret-backed --
// the entity row's own "N variables (M secret)" line.
func SecretCount(e Environment) int {
	n := 0
	for _, v := range e.Vars {
		if v.Secret {
			n++
		}
	}
	return n
}
