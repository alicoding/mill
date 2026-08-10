// Package seeding holds the small helpers shared by more than one
// service package for seeded/built-in data lifecycle: readable entity
// ID generation (NewSlugID) and the seed-tombstone bookkeeping that
// keeps top-up seeding from resurrecting a deliberately deleted
// built-in (LoadTombstones/RecordTombstone). Only genuinely
// cross-package helpers live here -- anything with a single consumer
// stays in that consumer's own package.
package seeding

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/adapters/settings"
)

var nonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

// NewSlugID derives a readable, collision-resistant ID from label (e.g.
// "My Workflow" -> "my-workflow-a1b2c3") -- stable/debuggable, unlike an
// opaque UUID, while the random suffix keeps two same-named entities
// from colliding. Shared by CompositionService (workflows) and
// ConfigureService (requests, lists, MCP servers) -- same generation
// shape, not duplicated per caller.
func NewSlugID(label, fallback string) string {
	slug := nonAlnum.ReplaceAllString(strings.ToLower(strings.TrimSpace(label)), "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		slug = fallback
	}
	suffix := make([]byte, 3)
	_, _ = rand.Read(suffix)
	return slug + "-" + hex.EncodeToString(suffix)
}

// seedTombstonesKey records built-in example IDs the user deliberately
// deleted, so top-up seeding (topUpBuiltIns on each service) never
// resurrects them -- seeds are top-up rather than fresh-install-only by
// direct user decision ("every feature we build needs proof with a
// seeded example" -- a new example must reach an existing instance),
// and the tombstone is what keeps §2.2's fully-deletable principle
// true at the same time.
const seedTombstonesKey = "seed-tombstones"

// LoadTombstones returns the set of tombstoned built-in IDs.
func LoadTombstones(store settings.Store) map[string]bool {
	out := map[string]bool{}
	raw, ok := store.Get(seedTombstonesKey).(string)
	if !ok || raw == "" {
		return out
	}
	var ids []string
	if err := json.Unmarshal([]byte(raw), &ids); err != nil {
		return out
	}
	for _, id := range ids {
		out[id] = true
	}
	return out
}

// RecordTombstone persists id into the tombstone list -- call only for
// IDs that belong to a built-in seed set (a user-authored ID can never
// be resurrected by top-up, so tombstoning it would be dead weight).
func RecordTombstone(store settings.Store, id string) {
	tombstones := LoadTombstones(store)
	if tombstones[id] {
		return
	}
	tombstones[id] = true
	ids := make([]string, 0, len(tombstones))
	for t := range tombstones {
		ids = append(ids, t)
	}
	sort.Strings(ids)
	data, err := json.Marshal(ids)
	if err != nil {
		return
	}
	_ = store.Set(seedTombstonesKey, string(data))
}
