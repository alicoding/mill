package composition

import (
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/adapters/markdown"
)

// Package-level function var, not a direct call -- same testability
// pattern as internal/domain/runbook.
var htmlToMarkdown = markdown.ToMarkdown

func init() {
	RegisterNodeType(NodeType{
		ID: "process-html-to-markdown", Kind: KindProcess,
		Label:       "Convert HTML to Markdown",
		Complexity:  ComplexityBasic,
		Consumes:    []PayloadKind{PayloadHTML},
		Produces:    PayloadProduce{Kind: PayloadMarkdown},
		Output:      "Markdown text",
		Description: "Converts HTML into Markdown, preserving structure (headings, bold, lists).",
		ConfigFields: []ConfigField{
			{
				Key: "profileId", Label: "Conversion profile", Type: FieldText, RefKind: "conversionprofile", OptionalRef: true,
				Description: "Which source-specific rules apply (Confluence, Office). Empty applies every rule set.",
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		md, err := htmlToMarkdownWithProfile(ctx.Payload, node.Config["profileId"])
		if err != nil {
			return ctx, err
		}
		ctx.Payload = md
		return ctx, nil
	})
}

// ResolvedConversionProfile is what the converter step needs from a
// Configure conversion profile (goal 0305 slice 6): the rule set ids.
type ResolvedConversionProfile struct {
	Label    string
	RuleSets []string
}

var lookupConversionProfileFn = func(id string) (ResolvedConversionProfile, error) {
	return ResolvedConversionProfile{}, fmt.Errorf("no conversion profile lookup registered (yet) for id %q", id)
}

// SetConversionProfileLookup wires the Configure-owned profile store
// (backend.md's injected-func rule); ConfigureService's constructor
// calls it.
func SetConversionProfileLookup(fn func(id string) (ResolvedConversionProfile, error)) {
	if fn != nil {
		lookupConversionProfileFn = fn
	}
}

// ConversionRuleSetsFor answers a profile's rule sets, or ok=false for
// an empty id (every rule set applies) -- the preview door's own read.
func ConversionRuleSetsFor(profileID string) (ruleSets []string, ok bool, err error) {
	if strings.TrimSpace(profileID) == "" {
		return nil, false, nil
	}
	p, err := lookupConversionProfileFn(profileID)
	if err != nil {
		return nil, false, err
	}
	return p.RuleSets, true, nil
}

// htmlToMarkdownWithProfile converts with the profile's rule sets, or
// with every rule set when no profile is chosen.
func htmlToMarkdownWithProfile(html, profileID string) (string, error) {
	ruleSets, ok, err := ConversionRuleSetsFor(profileID)
	if err != nil {
		return "", err
	}
	if !ok {
		return htmlToMarkdown(html)
	}
	return markdown.ToMarkdownWith(html, markdown.Options{RuleSets: ruleSets})
}
