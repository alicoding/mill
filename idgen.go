package main

import (
	"crypto/rand"
	"encoding/hex"
	"regexp"
	"strings"
)

var nonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

// newSlugID derives a readable, collision-resistant ID from label (e.g.
// "My Workflow" -> "my-workflow-a1b2c3") -- stable/debuggable, unlike an
// opaque UUID, while the random suffix keeps two same-named entities
// from colliding. Shared by CompositionService (workflows) and
// ConfigureService (connectors, lists) -- same generation shape, not
// duplicated per caller.
func newSlugID(label, fallback string) string {
	slug := nonAlnum.ReplaceAllString(strings.ToLower(strings.TrimSpace(label)), "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		slug = fallback
	}
	suffix := make([]byte, 3)
	_, _ = rand.Read(suffix)
	return slug + "-" + hex.EncodeToString(suffix)
}
