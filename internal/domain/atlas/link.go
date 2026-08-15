package atlas

import (
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// Link is a typed, owner-authored relation between two cards -- binds
// by card ID (a key), never by title (ADR-0038 Decision 3), so a card
// rename can never silently break a relation.
type Link struct {
	ID         string
	FromCardID string
	ToCardID   string
	LinkKindID string
	Label      string
	CreatedAt  time.Time
	UpdatedAt  time.Time
	BuiltIn    bool
	Seed       seedorigin.Origin
}

// ValidateLink checks a Link is well-formed: its three ID fields are
// non-empty strings. Whether FromCardID/ToCardID/LinkKindID actually
// name existing entities is referential-existence checking, done by
// the service layer (docs/goals/0061's Validation note), not here.
func ValidateLink(l Link) error {
	if strings.TrimSpace(l.FromCardID) == "" {
		return fmt.Errorf("a link needs a from-card id")
	}
	if strings.TrimSpace(l.ToCardID) == "" {
		return fmt.Errorf("a link needs a to-card id")
	}
	if strings.TrimSpace(l.LinkKindID) == "" {
		return fmt.Errorf("a link needs a link kind id")
	}
	return nil
}
