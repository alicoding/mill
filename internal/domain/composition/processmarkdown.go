package composition

import "github.com/alicoding/mill/internal/adapters/markdown"

// Package-level function var, not a direct call -- same testability
// pattern as internal/domain/runbook.
var htmlToMarkdown = markdown.ToMarkdown

func init() {
	RegisterNodeType(NodeType{
		ID: "process-html-to-markdown", Kind: KindProcess,
		Label:       "Process: HTML → Markdown",
		Complexity:  ComplexityBasic,
		Output:      "Markdown text",
		Description: "Converts HTML into Markdown, preserving structure (headings, bold, lists).",
	}, func(_ Node, ctx ExecContext) (ExecContext, error) {
		md, err := htmlToMarkdown(ctx.Payload)
		if err != nil {
			return ctx, err
		}
		ctx.Payload = md
		return ctx, nil
	})
}
