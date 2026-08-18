package composition

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// atlasDocsSyncFn regenerates an Atlas space from a folder of markdown
// files -- injected so this domain package never depends on atlassvc's
// storage (.claude/rules/backend.md), which owns the scan, the
// find-or-create-by-mirror-path idempotency, and checksum refresh.
// Returns a short JSON summary ({"created":N,"refreshed":N,"ids":[...]}).
// Defaults to erroring so a node run before SetAtlasDocsSync is wired
// fails loudly.
var atlasDocsSyncFn = func(folderPath, parentTitle, kindLabel, sourceRunID string) (string, error) {
	return "", fmt.Errorf("no atlas docs sync registered (yet)")
}

// SetAtlasDocsSync wires the function apply-atlas-docs-sync nodes use.
// Called once from main.go once AtlasService exists.
func SetAtlasDocsSync(fn func(folderPath, parentTitle, kindLabel, sourceRunID string) (string, error)) {
	atlasDocsSyncFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "apply-atlas-docs-sync", Kind: KindApply,
		Label: "Mirror docs folder into Atlas",
		// ClassLocal: writes to Atlas's own persisted store, same
		// classification as the other apply-atlas-* nodes.
		Effect:     guardrail.ClassLocal,
		Complexity: ComplexityBasic,
		Output:     "payload unchanged; a sync-summary JSON -> the output attribute, if named",
		Description: "Mirrors every markdown file in a folder as a card under one parent: a file already " +
			"mirrored keeps its card (checksum refreshed), a new file becomes a new card, so re-running " +
			"stays safe. The parent card is found by title, or created when missing.",
		ConfigFields: []ConfigField{
			{
				Key: "folderPath", Label: "Folder path", Type: FieldText,
				Description: "Folder whose markdown files become mirror cards.",
			},
			{
				Key: "parentTitle", Label: "Parent card title", Type: FieldText,
				Description: "Cards land under the card with this title, created if missing. Empty uses the space root.",
			},
			{
				Key: "kindLabel", Label: "Kind", Type: FieldText,
				Description: "Kind label for created cards. Empty uses your first kind.",
			},
			{
				Key: "outputAttribute", Label: "Output attribute (optional)", Type: FieldText,
				Description: "Which Attributes field receives a summary of what changed.",
			},
		},
	}, execAtlasDocsSync)
}

func execAtlasDocsSync(node Node, ctx ExecContext) (ExecContext, error) {
	folder := node.Config["folderPath"]
	if folder == "" {
		return ctx, fmt.Errorf("apply-atlas-docs-sync: folderPath is required")
	}
	summary, err := atlasDocsSyncFn(folder, node.Config["parentTitle"], node.Config["kindLabel"], currentRunID(ctx.RunContext))
	if err != nil {
		return ctx, fmt.Errorf("apply-atlas-docs-sync: %w", err)
	}
	if outAttr := node.Config["outputAttribute"]; outAttr != "" {
		if ctx.Attributes == nil {
			ctx.Attributes = map[string]any{}
		}
		ctx.Attributes[outAttr] = summary
	}
	return ctx, nil
}
