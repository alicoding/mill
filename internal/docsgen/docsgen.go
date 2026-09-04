// Package docsgen derives the user-facing step reference and the
// AI-readable llms.txt index from Mill's own registries and docs tree
// (goal 0125, the tfplugindocs commit-and-verify shape): the generator
// emits markdown committed to userdocs/, and TestUserDocs_MatchCommitted
// fails the build when the committed files drift from what the live
// registry would generate -- reference docs that cannot rot.
package docsgen

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/domain/composition"
)

//go:generate go run ./gen

// GenerateStepReference renders every registered NodeType as one
// reference page, grouped by Kind in registry display order --
// label, typed I/O contract, effect class, description, and config
// fields, all straight from the registry.
func GenerateStepReference() string {
	var b strings.Builder
	b.WriteString("# Step reference\n\n")
	b.WriteString("Generated from the live step registry — every step's contract exactly as the canvas enforces it. Do not edit by hand; `go generate ./internal/docsgen` regenerates.\n")

	kindTitles := []struct {
		kind  composition.NodeKind
		title string
	}{
		{composition.KindTrigger, "Triggers"},
		{composition.KindCapture, "Capture"},
		{composition.KindProcess, "Process"},
		{composition.KindApply, "Act"},
		{composition.KindDecision, "Flow"},
		{composition.KindTerminal, "Record"},
	}
	types := composition.NodeTypes()
	for _, kt := range kindTitles {
		writeKindSection(&b, kt.title, kt.kind, types)
	}
	return b.String()
}

func writeKindSection(b *strings.Builder, title string, kind composition.NodeKind, types []composition.NodeType) {
	var members []composition.NodeType
	for _, nt := range types {
		if nt.Kind == kind {
			members = append(members, nt)
		}
	}
	if len(members) == 0 {
		return
	}
	sort.Slice(members, func(i, j int) bool { return members[i].Label < members[j].Label })
	fmt.Fprintf(b, "\n## %s\n", title)
	for _, nt := range members {
		writeStep(b, nt)
	}
}

func writeStep(b *strings.Builder, nt composition.NodeType) {
	fmt.Fprintf(b, "\n### %s\n\n", nt.Label)
	fmt.Fprintf(b, "%s\n\n", nt.Description)
	fmt.Fprintf(b, "- Takes: %s — Produces: %s\n", describeConsumes(nt.Consumes), describeProduce(nt))
	fmt.Fprintf(b, "- Effect: %s\n", describeEffect(string(nt.Effect)))
	if len(nt.ConfigFields) == 0 {
		return
	}
	b.WriteString("- Settings:\n")
	for _, f := range nt.ConfigFields {
		fmt.Fprintf(b, "  - **%s** — %s%s\n", f.Label, f.Description, describeRefKind(f.RefKind))
	}
}

// describeRefKind names which Configure entity family a ConfigField
// references (docs/adr/0009's RefKind, typedfield.Field's own doc
// comment lists the closed set) -- the reference table's own answer to
// goal 0231's "does the docs system cover entity FIELD schemas"
// question: every step-reference field that points at a Configure
// entity says so, generated straight off the live registry the same way
// every other line in this table already is. Empty for an ordinary
// field with no Configure reference.
func describeRefKind(refKind string) string {
	switch refKind {
	case "request":
		return " (references an Integration)"
	case "list":
		return " (references a List)"
	case "mcpserver":
		return " (references an MCP Server)"
	case "decision":
		return " (references a Decision)"
	case "workflow":
		return " (references a callable Workflow)"
	case "execenv":
		return " (references an Execution environment)"
	case "conversionprofile":
		return " (references a Conversion profile)"
	default:
		return ""
	}
}

func describeConsumes(kinds []composition.PayloadKind) string {
	if len(kinds) == 1 && kinds[0] == composition.PayloadNone {
		return "nothing"
	}
	var parts []string
	optional := false
	for _, k := range kinds {
		if k == composition.PayloadNone {
			optional = true
			continue
		}
		parts = append(parts, describeKind(k))
	}
	out := strings.Join(parts, " or ")
	if optional {
		out += " (optional)"
	}
	if out == "" {
		return "nothing"
	}
	return out
}

func describeProduce(nt composition.NodeType) string {
	if nt.Produces.Passthrough {
		return "its input, unchanged"
	}
	if nt.Produces.Kind == composition.PayloadNone {
		if nt.Kind == composition.KindTrigger {
			return "an empty start"
		}
		return "nothing"
	}
	return describeKind(nt.Produces.Kind)
}

func describeKind(k composition.PayloadKind) string {
	switch k {
	case composition.PayloadAny:
		return "anything"
	case composition.PayloadHTML:
		return "HTML"
	case composition.PayloadJSON:
		return "JSON"
	case composition.PayloadMarkdown:
		return "Markdown"
	default:
		return string(k)
	}
}

func describeEffect(effect string) string {
	switch effect {
	case "external":
		return "external — parks for approval by default"
	case "local":
		return "changes something on this machine"
	case "read":
		return "reads local state"
	default:
		return "none — pure computation"
	}
}

// DocPage is one entry in the docs index, in reading order -- shared
// by the llms.txt generator and the in-app Docs surface (docssvc), so
// nav order and the AI index can never drift apart.
type DocPage struct {
	Rel, Title, Note string
}

// PageIndex is the canonical reading order.
func PageIndex() []DocPage {
	return []DocPage{
		{"start-here/what-is-mill.md", "What is Mill", "the product in three ideas"},
		{"start-here/install.md", "Install", "release install, source build, where data lives"},
		{"start-here/first-workflow.md", "Your first workflow", "run the seeded example, then rebuild it"},
		{"concepts/workflows-and-steps.md", "Workflows and steps", "triggers, the typed step contract, payload vs attributes, versions"},
		{"concepts/guardrails.md", "Guardrails and effect classes", "what asks for approval and how rules scope it"},
		{"concepts/configure.md", "Configure entities", "integrations, lists, MCP servers, AI providers, environments"},
		{"concepts/atlas.md", "Atlas", "the knowledge board: kinds, links, areas, doc mirrors, card actions"},
		{"concepts/runs-and-review.md", "Runs, review, and debugging", "durable runs, the review queue, breakpoints"},
		{"concepts/coding-loop.md", "The coding loop", "copy a command, confirm the parsed steps, watch it run, copy the result back"},
		{"reference/steps.md", "Step reference", "every step's contract, generated from the registry"},
		{"reference/commands.md", "Commands", "every registered command's id, label, default binding, surface, and enablement, generated from the registry"},
		{"reference/settings.md", "Settings", "app preferences: appearance, hotkeys, shortcuts, MCP access, remote access, backups, updates"},
		{"reference/extending-the-canvas.md", "Extending the canvas", "how a canvas noun loads, what its declaration requires, and what platform APIs it may and may not reach"},
		{"reference/register-a-canvas-tool.md", "Register a canvas tool", "walks a new AtlasToolShape declaration end to end, quoting a real registered tool"},
		{"reference/register-a-command.md", "Register a command", "walks a new Command registry entry end to end, quoting a real registered command"},
		{"agents/connect-mcp.md", "Automate with agents", "connecting over MCP and what agents can do"},
		{"agents/diagrams.md", "Edit a diagram with an agent", "reading a diagram's shapes by id and adding, changing, deleting and importing them in place"},
		{"trust/data-and-safety.md", "Trust, data, and safety", "no phone-home, local data, honest limits"},
	}
}

func docPages(root string) ([]DocPage, error) {
	order := PageIndex()
	for _, p := range order {
		if _, err := os.Stat(filepath.Join(root, p.Rel)); err != nil {
			return nil, fmt.Errorf("llms index names a missing page: %w", err)
		}
	}
	return order, nil
}

// GenerateLLMSTxt emits the llms.txt index (llmstxt.org shape: H1,
// blockquote summary, one linked list) for the docs tree at root.
func GenerateLLMSTxt(root string) (string, error) {
	pages, err := docPages(root)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString("# Mill\n\n")
	b.WriteString("> Mill is a desktop app for guardrailed automation: workflows composed from typed steps, run by hotkey/schedule/watcher, with every external effect gated for approval — and a full MCP surface so AI agents can drive it under the same guardrails. Single binary, local data, no phone-home.\n\n")
	b.WriteString("## Docs\n\n")
	for _, p := range pages {
		fmt.Fprintf(&b, "- [%s](%s): %s\n", p.Title, p.Rel, p.Note)
	}
	return b.String(), nil
}

// GenerateLLMSFullTxt concatenates every indexed page's content into
// the single-file variant agents ingest whole.
func GenerateLLMSFullTxt(root string) (string, error) {
	pages, err := docPages(root)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString("# Mill — full documentation\n")
	for _, p := range pages {
		raw, err := os.ReadFile(filepath.Join(root, p.Rel)) // #nosec G304 -- p.rel comes from the fixed docPages list above, never input
		if err != nil {
			return "", err
		}
		b.WriteString("\n---\n\n")
		b.Write(raw)
	}
	return b.String(), nil
}
