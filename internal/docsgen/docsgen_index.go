package docsgen

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/alicoding/mill/internal/adapters/markdown"
)

// PageKind is a page's Diátaxis quadrant -- what the reader is doing
// when they open it. Every page declares its kind in YAML front
// matter (`kind: how-to`), and the index entry repeats it; docPages
// fails generation when the two disagree or either is missing, so the
// nav grouping and llms.txt sections can never drift from the pages.
type PageKind string

const (
	KindTutorial    PageKind = "tutorial"
	KindHowTo       PageKind = "how-to"
	KindReference   PageKind = "reference"
	KindExplanation PageKind = "explanation"
)

// DocPage is one entry in the docs index, in reading order -- shared
// by the llms.txt generator and the in-app Docs surface (docssvc), so
// nav order and the AI index can never drift apart.
type DocPage struct {
	Rel, Title, Note string
	Kind             PageKind
}

// Group is the nav section a page sits in. Two sections are folders:
// start-here/ is the ordered onboarding path whatever each page's own
// kind, and agents/ keeps the agent-facing how-to pages together.
// Every other section is the page's kind.
func (p DocPage) Group() string {
	switch {
	case strings.HasPrefix(p.Rel, "start-here/"):
		return "start-here"
	case strings.HasPrefix(p.Rel, "agents/"):
		return "agents"
	}
	return string(p.Kind)
}

// GroupOrder is the fixed section order the nav and llms.txt share:
// the onboarding path, how-to, explanation, reference, then the agent
// pages.
var GroupOrder = []struct {
	ID, Title string
}{
	{"start-here", "Start here"},
	{string(KindHowTo), "How-to"},
	{string(KindExplanation), "Concepts"},
	{string(KindReference), "Reference"},
	{"agents", "For agents"},
}

// PageIndex is the canonical reading order, already grouped the way
// GroupOrder lists the sections.
func PageIndex() []DocPage {
	return []DocPage{
		{"start-here/what-is-mill.md", "What is Mill", "the product in three ideas", KindExplanation},
		{"start-here/install.md", "Install", "release install, source build, where data lives", KindHowTo},
		{"start-here/first-workflow.md", "Your first workflow", "run the seeded example, then rebuild it", KindTutorial},
		{"start-here/first-board.md", "Your first board", "place a card, a table and a diagram on a board, line them up, undo", KindTutorial},
		{"how-to/store-and-reference-a-secret.md", "Store and reference a secret", "put a value in the vault and pick it wherever a step needs it", KindHowTo},
		{"reference/install-a-plugin.md", "Install a plugin", "installing from a marketplace, a repository, or a folder, and what the badge means", KindHowTo},
		{"concepts/workflows-and-steps.md", "Workflows and steps", "triggers, the typed step contract, payload vs attributes, versions", KindExplanation},
		{"concepts/guardrails.md", "Guardrails and effect classes", "what asks for approval and how rules scope it", KindExplanation},
		{"concepts/configure.md", "Configure entities", "integrations, lists, MCP servers, AI providers, environments", KindExplanation},
		{"concepts/atlas.md", "Atlas", "the knowledge board: kinds, links, areas, doc mirrors, card actions", KindExplanation},
		{"concepts/runs-and-review.md", "Runs, review, and debugging", "durable runs, the review queue, breakpoints", KindExplanation},
		{"concepts/coding-loop.md", "The coding loop", "copy a command, confirm the parsed steps, watch it run, copy the result back", KindExplanation},
		{"concepts/secrets.md", "Secrets are references", "the vault, references in every secret field, sources, the lock policy", KindExplanation},
		{"concepts/extensions.md", "Extensions and trust", "the store, sources, verification tiers, and what an extension can reach", KindExplanation},
		{"trust/data-and-safety.md", "Trust, data, and safety", "no phone-home, local data, honest limits", KindExplanation},
		{"reference/steps.md", "Step reference", "every step's contract, generated from the registry", KindReference},
		{"reference/commands.md", "Commands", "every registered command's id, label, default binding, surface, and enablement, generated from the registry", KindReference},
		{"reference/menu-bar.md", "Menu bar", "every menu and item in the macOS menu bar, its shortcut, and the command behind it, generated from the registry", KindReference},
		{"reference/environments.md", "Environments", "named sets of plain and secret variables, {{var}} in a request, and which one a run selects", KindReference},
		{"reference/client-certificates.md", "Client certificates", "presenting a client certificate per host: formats, matching, expiry status, and the Test action", KindReference},
		{"reference/browser-extension.md", "The browser extension", "pairing a browser so Mill can replay recorded steps in your own signed-in session", KindReference},
		{"reference/settings.md", "Settings", "app preferences: appearance, vault lock policy, hotkeys, shortcuts, MCP access, remote access, backups, updates", KindReference},
		{"reference/extending-the-canvas.md", "Extending the canvas", "how a canvas noun loads, what its declaration requires, and what platform APIs it may and may not reach", KindReference},
		{"reference/register-a-canvas-tool.md", "Register a canvas tool", "walks a new AtlasToolShape declaration end to end, quoting a real registered tool", KindReference},
		{"reference/register-a-command.md", "Register a command", "walks a new Command registry entry end to end, quoting a real registered command", KindReference},
		{"reference/plugin-standard.md", "The plugin standard", "the rules a shipped plugin follows, and which ones the conformance checker enforces", KindReference},
		{"reference/plugin-theming.md", "Plugin theming", "the theme variables a plugin renders with", KindReference},
		{"reference/managed-extensions.md", "Managed extensions", "the organisation policy file: allow and block lists, required tier, blocked capabilities, allowed sources, and what an install checks", KindReference},
		{"reference/plugin-api-maturity.md", "Plugin API maturity", "each contribution family's level and its proof, generated from the repository", KindReference},
		{"agents/connect-mcp.md", "Automate with agents", "connecting over MCP and what agents can do", KindHowTo},
		{"agents/diagrams.md", "Edit a diagram with an agent", "reading a diagram's shapes by id and adding, changing, deleting and importing them in place", KindHowTo},
		{"agents/plugins.md", "What plugins expose to agents", "listing installed plugins, calling a plugin's declared tools, and how a plugin write parks", KindHowTo},
	}
}

// PageByRel finds an index entry by its rel path.
func PageByRel(rel string) (DocPage, bool) {
	for _, p := range PageIndex() {
		if p.Rel == rel {
			return p, true
		}
	}
	return DocPage{}, false
}

func knownKind(k PageKind) bool {
	switch k {
	case KindTutorial, KindHowTo, KindReference, KindExplanation:
		return true
	}
	return false
}

// readPageBody returns a page's markdown with its front matter removed,
// after checking the front matter's kind against the index entry.
func readPageBody(root string, p DocPage) (string, error) {
	raw, err := os.ReadFile(filepath.Join(root, p.Rel)) // #nosec G304 -- p.Rel comes from the fixed PageIndex list, never input
	if err != nil {
		return "", fmt.Errorf("docs index names a missing page: %w", err)
	}
	fm, err := markdown.SplitFrontMatter(string(raw))
	if err != nil {
		return "", fmt.Errorf("%s: %w", p.Rel, err)
	}
	if !knownKind(p.Kind) {
		return "", fmt.Errorf("%s: index entry has unknown kind %q", p.Rel, p.Kind)
	}
	got := PageKind(fm.Fields["kind"])
	switch {
	case got == "":
		return "", fmt.Errorf("%s: front matter declares no kind (want `kind: %s`)", p.Rel, p.Kind)
	case !knownKind(got):
		return "", fmt.Errorf("%s: front matter kind %q is not tutorial, how-to, reference, or explanation", p.Rel, got)
	case got != p.Kind:
		return "", fmt.Errorf("%s: front matter kind %q disagrees with the index (%q)", p.Rel, got, p.Kind)
	}
	return fm.Body, nil
}

// docPages validates every indexed page (present, front matter kind
// declared and matching) and returns the index.
func docPages(root string) ([]DocPage, error) {
	order := PageIndex()
	for _, p := range order {
		if _, err := readPageBody(root, p); err != nil {
			return nil, err
		}
	}
	return order, nil
}

// GenerateLLMSTxt emits the llms.txt index (llmstxt.org shape: H1,
// blockquote summary, one linked list per section) for the docs tree
// at root, sectioned the way the in-app nav is.
func GenerateLLMSTxt(root string) (string, error) {
	pages, err := docPages(root)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString("# Mill\n\n")
	b.WriteString("> Mill is a desktop app for guardrailed automation: workflows composed from typed steps, run by hotkey/schedule/watcher, with every external effect gated for approval — and a full MCP surface so AI agents can drive it under the same guardrails. Single binary, local data, no phone-home.\n")
	for _, g := range GroupOrder {
		wroteHeading := false
		for _, p := range pages {
			if p.Group() != g.ID {
				continue
			}
			if !wroteHeading {
				fmt.Fprintf(&b, "\n## %s\n\n", g.Title)
				wroteHeading = true
			}
			fmt.Fprintf(&b, "- [%s](%s): %s\n", p.Title, p.Rel, p.Note)
		}
	}
	return b.String(), nil
}

// GenerateLLMSFullTxt concatenates every indexed page's body into the
// single-file variant agents ingest whole -- front matter dropped, it
// is index metadata, not content.
func GenerateLLMSFullTxt(root string) (string, error) {
	pages, err := docPages(root)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString("# Mill — full documentation\n")
	for _, p := range pages {
		body, err := readPageBody(root, p)
		if err != nil {
			return "", err
		}
		b.WriteString("\n---\n\n")
		b.WriteString(body)
	}
	return b.String(), nil
}
