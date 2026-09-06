// Package docsgen derives the user-facing step reference and the
// AI-readable llms.txt index from Mill's own registries and docs tree
// (goal 0125, the tfplugindocs commit-and-verify shape): the generator
// emits markdown committed to userdocs/, and TestUserDocs_MatchCommitted
// fails the build when the committed files drift from what the live
// registry would generate -- reference docs that cannot rot.
package docsgen

import (
	"fmt"
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
	b.WriteString("---\nkind: reference\n---\n\n# Step reference\n\n")
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
