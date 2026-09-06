package docsgen

import "testing"

// Sections are the page's kind, except the two folder-defined ones:
// start-here/ is the onboarding path whatever each page's kind, and
// agents/ keeps the agent how-to pages together.
func TestDocPage_Group(t *testing.T) {
	cases := []struct {
		page DocPage
		want string
	}{
		{DocPage{Rel: "start-here/what-is-mill.md", Kind: KindExplanation}, "start-here"},
		{DocPage{Rel: "start-here/install.md", Kind: KindHowTo}, "start-here"},
		{DocPage{Rel: "agents/connect-mcp.md", Kind: KindHowTo}, "agents"},
		{DocPage{Rel: "reference/install-a-plugin.md", Kind: KindHowTo}, "how-to"},
		{DocPage{Rel: "trust/data-and-safety.md", Kind: KindExplanation}, "explanation"},
		{DocPage{Rel: "reference/steps.md", Kind: KindReference}, "reference"},
	}
	for _, c := range cases {
		if got := c.page.Group(); got != c.want {
			t.Errorf("%s: group = %q, want %q", c.page.Rel, got, c.want)
		}
	}
	for _, p := range PageIndex() {
		known := false
		for _, g := range GroupOrder {
			if g.ID == p.Group() {
				known = true
			}
		}
		if !known {
			t.Errorf("%s: group %q is not in GroupOrder", p.Rel, p.Group())
		}
	}
}
