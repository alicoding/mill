package atlas

import (
	"strings"

	"gopkg.in/yaml.v3"
)

// GoalFrontmatter is the machine-readable header goal 0164 defines for
// docs/goals/archive/*.md: a structured header over an otherwise
// narrative body (id, status, date, prs, proof, spec_refs). Only
// id/date/prs/proof feed the delivery-ledger mirror's Fields -- status
// and spec_refs aren't part of that Kind's schema and are parsed here
// only so a caller inspecting the full header doesn't need a second
// parse pass.
type GoalFrontmatter struct {
	ID       string   `yaml:"id"`
	Status   string   `yaml:"status"`
	Date     string   `yaml:"date"`
	PRs      []string `yaml:"prs"`
	Proof    []string `yaml:"proof"`
	SpecRefs []string `yaml:"spec_refs"`
}

// ParseFrontmatter extracts the YAML header framed by content's first
// two standalone "---" lines. Bounded to exactly those two delimiter
// lines -- found by scanning forward from line 1 and stopping at the
// FIRST match -- so a document whose body also contains a standalone
// "---" (a markdown horizontal rule right after the header, as two
// files in docs/goals/archive already do) is never misread as framing
// a second frontmatter block. ok is false, with no error, when content
// doesn't open with a "---" line at all or never closes one -- absent
// frontmatter is a normal case for this parser, not a failure.
func ParseFrontmatter(content []byte) (fm GoalFrontmatter, ok bool, err error) {
	lines := strings.Split(string(content), "\n")
	if len(lines) == 0 || strings.TrimRight(lines[0], "\r") != "---" {
		return GoalFrontmatter{}, false, nil
	}
	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimRight(lines[i], "\r") == "---" {
			end = i
			break
		}
	}
	if end == -1 {
		return GoalFrontmatter{}, false, nil
	}
	block := strings.Join(lines[1:end], "\n")
	if err := yaml.Unmarshal([]byte(block), &fm); err != nil {
		return GoalFrontmatter{}, false, err
	}
	return fm, true, nil
}
