// Package conversionprofile is the Configure entity choosing which
// source-specific rule sets an HTML-to-Markdown conversion applies
// (goal 0305 slice 6): the Pandoc-shaped named reader option, never an
// engine switch. The rule sets themselves live in the markdown adapter;
// a profile only names them.
package conversionprofile

import (
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
)

type Profile struct {
	ID          string
	Label       string
	Description string
	// RuleSets names the adapter rule sets turned on (ids); empty means
	// the stock converter alone.
	RuleSets  []string
	BuiltIn   bool
	Seed      seedorigin.Origin
	CreatedAt time.Time
	UpdatedAt time.Time
}

var ErrInvalid = errors.New("conversion profile: invalid")

// Validate: a label, and rule set ids de-duplicated and sorted so two
// authored profiles with the same choice compare equal.
func Validate(p *Profile) error {
	if strings.TrimSpace(p.Label) == "" {
		return errors.Join(ErrInvalid, errors.New("a label is required"))
	}
	seen := map[string]bool{}
	var clean []string
	for _, id := range p.RuleSets {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		clean = append(clean, id)
	}
	sort.Strings(clean)
	p.RuleSets = clean
	return nil
}

const (
	DefaultID    = "conversionprofile-default"
	PlainID      = "conversionprofile-plain"
	ConfluenceID = "conversionprofile-confluence"
)

// BuiltIn seeds the three profiles every instance starts with: every
// rule set (what the converter does with no profile chosen), the stock
// converter alone, and Confluence only. Each is a seeded example the
// profile page's sample preview compares side by side.
func BuiltIn() []Profile {
	return []Profile{
		{ID: DefaultID, Label: "Example: Every rule set", Description: "Confluence and Office rules on -- what a conversion does when no profile is chosen.", RuleSets: []string{"confluence", "office"}, BuiltIn: true, Seed: seedorigin.Stamp(1)},
		{ID: PlainID, Label: "Example: Plain HTML", Description: "The stock converter alone, no source-specific rules.", RuleSets: []string{}, BuiltIn: true, Seed: seedorigin.Stamp(1)},
		{ID: ConfluenceID, Label: "Example: Confluence only", Description: "Confluence rules on, Office rules off.", RuleSets: []string{"confluence"}, BuiltIn: true, Seed: seedorigin.Stamp(1)},
	}
}
