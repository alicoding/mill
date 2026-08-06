// Package composition is a prototype for SPEC.md §3 (capability
// composition), testing ADR-0005's node/recipe shape against real,
// working code rather than a mockup -- see docs/SPEC.md's `UX: PROTOTYPE`
// entry under §3. It is additive: internal/domain/runbook is untouched,
// still the tested/tuned path for load-sample-html and clipboard-html-
// to-markdown. This package's node primitives call the *same* adapter
// functions runbook.go calls, decomposed into reusable Capture/Process/
// Apply steps (§2's already-locked core primitive) and recomposed into
// recipes -- the same real capability, not a fictional example.
package composition

import (
	"fmt"

	"github.com/alicoding/mill/internal/adapters/clipboard"
	"github.com/alicoding/mill/internal/adapters/markdown"
)

// Package-level function vars, not direct calls -- same testability
// pattern as internal/domain/runbook.
var (
	readClipboardHTML  = clipboard.ReadHTML
	writeClipboardHTML = clipboard.WriteHTML
	writeClipboardText = clipboard.WriteText
	htmlToMarkdown     = markdown.ToMarkdown
)

// NodeKind mirrors SPEC.md §2's Capture -> Process -> Apply primitive --
// today's node types are drawn from that already-locked shape rather
// than the fuller Ruleset/Decision/... taxonomy ADR-0005 surveys, since
// only Capture/Process/Apply nodes exist as real code yet. Control-flow
// node kinds (Decision, Parallel, Child Workflow) stay real future work,
// not stubbed here speculatively.
type NodeKind string

const (
	KindCapture NodeKind = "capture"
	KindProcess NodeKind = "process"
	KindApply   NodeKind = "apply"
)

type NodeType struct {
	ID          string
	Kind        NodeKind
	Label       string
	Description string
}

// Recipe is a flat, ordered pipeline of node type IDs -- enough for
// today's two real recipes. Branching/parallel composition is real
// future work per ADR-0005, not invented here ahead of a need for it.
type Recipe struct {
	ID          string
	Label       string
	Description string
	NodeIDs     []string
}

// sampleHTML matches runbook.go's own fixture (duplicated deliberately,
// not imported: it's a demo fixture, not a fact either package should
// depend on the other for).
const sampleHTML = `<h2>Quarterly update</h2>
<p>Here's a quick summary, with <strong>the important bit</strong> called out.</p>
<ul>
  <li>Runbook actions now support global keyboard shortcuts</li>
  <li>Clipboard capture preserves <em>real</em> structure, not flattened text</li>
  <li>The UI now runs on Primer, not hand-rolled CSS</li>
</ul>`

func NodeTypes() []NodeType {
	return []NodeType{
		{
			ID: "capture-clipboard-html", Kind: KindCapture,
			Label:       "Capture: clipboard HTML",
			Description: "Reads whatever HTML is currently on the clipboard.",
		},
		{
			ID: "process-html-to-markdown", Kind: KindProcess,
			Label:       "Process: HTML → Markdown",
			Description: "Converts HTML into Markdown, preserving structure (headings, bold, lists).",
		},
		{
			ID: "apply-clipboard-write-text", Kind: KindApply,
			Label:       "Apply: write plain text to clipboard",
			Description: "Writes the recipe's current payload to the clipboard as plain text.",
		},
		{
			ID: "apply-clipboard-write-html", Kind: KindApply,
			Label:       "Apply: write sample HTML to clipboard",
			Description: "Writes a small, structurally real sample (heading, bold, list) to the clipboard as HTML.",
		},
	}
}

func Recipes() []Recipe {
	return []Recipe{
		{
			ID:          "load-sample-html-recipe",
			Label:       "Load sample HTML",
			Description: "A single-node recipe: puts a real HTML sample on the clipboard.",
			NodeIDs:     []string{"apply-clipboard-write-html"},
		},
		{
			ID:          "clipboard-html-to-markdown-recipe",
			Label:       "Clipboard → Markdown",
			Description: "Capture the clipboard's HTML, convert it to Markdown, write it back.",
			NodeIDs:     []string{"capture-clipboard-html", "process-html-to-markdown", "apply-clipboard-write-text"},
		},
	}
}

// nodeExec threads a single string payload from node to node -- enough
// for today's two real recipes. A richer typed payload is real future
// work once a node needs more than one value, not invented speculatively
// now.
var nodeExec = map[string]func(payload string) (string, error){
	"capture-clipboard-html": func(_ string) (string, error) {
		return readClipboardHTML()
	},
	"process-html-to-markdown": func(html string) (string, error) {
		return htmlToMarkdown(html)
	},
	"apply-clipboard-write-text": func(text string) (string, error) {
		if err := writeClipboardText(text); err != nil {
			return "", err
		}
		return text, nil
	},
	"apply-clipboard-write-html": func(_ string) (string, error) {
		if err := writeClipboardHTML(sampleHTML); err != nil {
			return "", err
		}
		return sampleHTML, nil
	},
}

// RunRecipe executes a recipe's nodes in order, threading one node's
// output into the next node's input. Errors here are plain/technical --
// unlike internal/domain/runbook's hand-tuned soft-failure copy (e.g.
// "no HTML found on the clipboard" with a nil error), this is a
// deliberate prototype simplification, not a regression: the careful UX
// still lives in runbook.go, untouched.
func RunRecipe(id string) (string, error) {
	var recipe *Recipe
	for _, r := range Recipes() {
		if r.ID == id {
			recipe = &r
			break
		}
	}
	if recipe == nil {
		return "", fmt.Errorf("unknown recipe: %s", id)
	}

	payload := ""
	for _, nodeID := range recipe.NodeIDs {
		exec, ok := nodeExec[nodeID]
		if !ok {
			return "", fmt.Errorf("recipe %s references unknown node %s", id, nodeID)
		}
		out, err := exec(payload)
		if err != nil {
			return "", fmt.Errorf("node %s: %w", nodeID, err)
		}
		payload = out
	}
	return payload, nil
}
