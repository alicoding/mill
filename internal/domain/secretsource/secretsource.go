// Package secretsource is the Configure entity behind ADR-0050's
// provider port: a named, user-enabled store of secrets that Mill reads
// through but never copies. Kind names the provider; Path is the
// provider's own address (a dotenv file for "env").
package secretsource

import (
	"errors"
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
)

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
	if s.Kind != KindEnv && s.Kind != KindBruno {
		return errors.Join(ErrInvalid, errors.New("unknown source kind "+string(s.Kind)))
	}
	if strings.TrimSpace(s.Path) == "" {
		return errors.Join(ErrInvalid, errors.New("a path is required"))
	}
	return nil
}

// BuiltIn: no seeded sources -- a source names a file on the user's
// own machine, so enabling one is always the user's act (ADR-0050).
func BuiltIn() []Source { return nil }
