package atlassvc

import (
	"os"
	"sort"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// This file is goal 0172 S2's own addition to ScanFolder's preview:
// the per-category "create a new type from these files" proposal.
// Split out of atlasservice_folderscan.go (architecture.md's 500-line
// limit) along the real seam between S1's original bounded-scan
// machinery and this later frontmatter-inference layer on top of it.

// FolderScanCategoryFields is one ScanCategory's own observed-
// frontmatter proposal (goal 0172 S2's "create a new type from these
// files"): the union of frontmatter keys found across every scanned
// entry in that category, each with an inferred typedfield.Type
// (atlas.InferFrontmatterFields). Computed over every entry ScanFolder
// found in the category, not narrowed to whatever the preview's own
// accept checkboxes later keep or drop -- the accept/reject choice
// only exists in the frontend, after this same scan already returned.
type FolderScanCategoryFields struct {
	Category atlas.ScanCategory
	Fields   []typedfield.Field
}

// readFileFrontmatter reads and parses one scanned file's own
// frontmatter, treating an unreadable file the same as one with none
// (ScanFolder's own preview must never fail because a single entry
// can't be read).
func readFileFrontmatter(abs string) (map[string]any, bool) {
	content, err := os.ReadFile(abs) //nolint:gosec // path built from a folder ScanFolder's own caller picked, scanned via fileread.Scan
	if err != nil {
		return nil, false
	}
	return parseFrontmatterOrNone(content)
}

// buildCategoryFields turns the per-category raw frontmatter maps
// ScanFolder collected into the sorted, deterministic proposal list
// FolderScanResult carries -- sorted by category name so two scans of
// the same folder always return CategoryFields in the same order.
func buildCategoryFields(byCategory map[atlas.ScanCategory][]map[string]any) []FolderScanCategoryFields {
	if len(byCategory) == 0 {
		return nil
	}
	categories := make([]string, 0, len(byCategory))
	for c := range byCategory {
		categories = append(categories, string(c))
	}
	sort.Strings(categories)

	out := make([]FolderScanCategoryFields, 0, len(categories))
	for _, c := range categories {
		category := atlas.ScanCategory(c)
		out = append(out, FolderScanCategoryFields{
			Category: category,
			Fields:   atlas.InferFrontmatterFields(byCategory[category]),
		})
	}
	return out
}
