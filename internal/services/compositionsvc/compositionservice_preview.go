package compositionsvc

import (
	"github.com/alicoding/mill/internal/adapters/markdown"
	"github.com/alicoding/mill/internal/domain/composition"
)

// PreviewHTMLToMarkdown converts html through the same converter
// process-html-to-markdown's node execution uses with no profile
// chosen (every rule set), so a preview always matches what a real run
// would produce. Empty input returns empty without invoking the
// converter -- there's nothing to preview.
func (c *CompositionService) PreviewHTMLToMarkdown(html string) (string, error) {
	if html == "" {
		return "", nil
	}
	return markdown.ToMarkdown(html)
}

// ConversionRuleSets lists the switchable rule sets a conversion
// profile can turn on -- the profile page's check boxes.
func (c *CompositionService) ConversionRuleSets() []markdown.RuleSet {
	return markdown.RuleSets()
}

// PreviewConversion converts html with exactly the given rule sets --
// the profile page's side-by-side sample (goal 0305 slice 6): one call
// per profile, the same converter a run uses.
func (c *CompositionService) PreviewConversion(html string, ruleSets []string) (string, error) {
	if html == "" {
		return "", nil
	}
	return markdown.ToMarkdownWith(html, markdown.Options{RuleSets: ruleSets})
}

// PreviewConversionWithProfile converts through a profile by id
// (empty: every rule set) -- what the converter step does.
func (c *CompositionService) PreviewConversionWithProfile(html, profileID string) (string, error) {
	if html == "" {
		return "", nil
	}
	ruleSets, ok, err := composition.ConversionRuleSetsFor(profileID)
	if err != nil {
		return "", err
	}
	if !ok {
		return markdown.ToMarkdown(html)
	}
	return markdown.ToMarkdownWith(html, markdown.Options{RuleSets: ruleSets})
}
