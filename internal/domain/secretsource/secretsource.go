// Package secretsource is the Configure entity behind ADR-0050's
// provider port: a named, user-enabled store of secrets that Mill reads
// through but never copies. Kind names the provider; Path is the
// provider's own address (a dotenv file for "env").
package secretsource

import (
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
)

type Kind string

const (
	// KindEnv reads a dotenv file (KEY=value lines): a project's own
	// .env, or a Bruno collection's -- Bruno's documented secrets
	// channel is exactly this file at the collection root.
	KindEnv Kind = "env"
	// KindBruno reads a Bruno collection (its folder, or its
	// bruno.json): the .env at the collection root supplies values, the
	// environments' `vars:secret` blocks name what the collection
	// expects, and bruno.json names it (goal 0306 slice 2).
	KindBruno Kind = "bruno"
	// KindOnePassword / KindBitwarden reach the user's password manager
	// through its own CLI (goal 0306 slice 3): titles are listed and one
	// value is read at use time; nothing is stored. Path is an optional
	// vault name for 1Password, unused for Bitwarden.
	KindOnePassword Kind = "op"
	KindBitwarden   Kind = "bw"
)

// PluginKindPrefix opens the vocabulary to extensions (goal 0306 S4):
// a kind of "plugin:<pluginID>/<sourceID>" names a store an installed
// extension reads, declared in its manifest and implemented in its own
// secrets file. The kind is well-formed here; whether that extension is
// installed and still declares that source is the plugin platform's
// answer, read at list and resolve time so a source survives its
// extension being turned off and back on.
const PluginKindPrefix = "plugin:"

// pluginKindPattern is the slug shape both ids in a plugin kind take --
// the same shape an extension id itself has.
var pluginKindPattern = regexp.MustCompile(`^plugin:[a-z0-9][a-z0-9-]{0,63}/[a-z0-9][a-z0-9-]{0,63}$`)

// PluginIDs splits a plugin kind into the extension and the source it
// names, ok=false for every built-in kind.
func (k Kind) PluginIDs() (pluginID, sourceID string, ok bool) {
	if !pluginKindPattern.MatchString(string(k)) {
		return "", "", false
	}
	pluginID, sourceID, _ = strings.Cut(strings.TrimPrefix(string(k), PluginKindPrefix), "/")
	return pluginID, sourceID, true
}

// IsPlugin reports whether this kind is answered by an extension.
func (k Kind) IsPlugin() bool {
	_, _, ok := k.PluginIDs()
	return ok
}

// NeedsPath reports whether a kind's Path is required (a file or folder
// to read) rather than an optional filter. A plugin kind's path
// requirement is the extension's own declaration, checked where that
// declaration is readable, so it is not required here.
func (k Kind) NeedsPath() bool { return k == KindEnv || k == KindBruno }

type Source struct {
	ID        string
	Label     string
	Kind      Kind
	Path      string
	BuiltIn   bool
	Seed      seedorigin.Origin
	CreatedAt time.Time
	UpdatedAt time.Time
}

var ErrInvalid = errors.New("secret source: invalid")

func Validate(s Source) error {
	if strings.TrimSpace(s.Label) == "" {
		return errors.Join(ErrInvalid, errors.New("a label is required"))
	}
	switch s.Kind {
	case KindEnv, KindBruno, KindOnePassword, KindBitwarden:
	default:
		if !s.Kind.IsPlugin() {
			return errors.Join(ErrInvalid, errors.New("unknown source kind "+string(s.Kind)))
		}
	}
	if s.Kind.NeedsPath() && strings.TrimSpace(s.Path) == "" {
		return errors.Join(ErrInvalid, errors.New("a path is required"))
	}
	return nil
}

// BuiltIn: no seeded sources -- a source names a file on the user's
// own machine, so enabling one is always the user's act (ADR-0050).
func BuiltIn() []Source { return nil }
