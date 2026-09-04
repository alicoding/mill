package composition

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// atlasLedgerSyncFn regenerates the delivery-evidence ledger from a
// folder of frontmattered markdown files -- injected so this domain
// package never depends on atlassvc's storage (.claude/rules/
// backend.md), which owns the scan, frontmatter parse, and the
// find-or-create-by-mirror-path idempotency. A sibling of
// atlasDocsSyncFn rather than a mode on it: docssync's own reconcile
// only ever refreshes MirrorChecksum, never Fields, so folding the
// ledger's "parse frontmatter into mirror-owned Fields, never touch
// owner-owned ones" behavior into that node would give every docssync
// caller a second, frontmatter-shaped code path it doesn't use.
// Returns a short JSON summary ({"created":N,"refreshed":N,"ids":[...]}).
// Defaults to erroring so a node run before SetAtlasLedgerSync is
// wired fails loudly.
var atlasLedgerSyncFn = func(folderPath, parentTitle, sourceRunID string) (string, error) {
	return "", fmt.Errorf("no atlas ledger sync registered (yet)")
}

// SetAtlasLedgerSync wires the function apply-atlas-ledger-sync nodes
// use. Called once from main.go once AtlasService exists.
func SetAtlasLedgerSync(fn func(folderPath, parentTitle, sourceRunID string) (string, error)) {
	atlasLedgerSyncFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "apply-atlas-ledger-sync", Kind: KindApply,
		Label: "Mirror delivery ledger from a docs folder",
		// ClassLocal: writes to Atlas's own persisted store, same
		// classification as the other apply-atlas-* nodes.
		Effect:     guardrail.ClassLocal,
		Complexity: ComplexityBasic,
		Consumes:   []PayloadKind{PayloadNone},
		Produces:   PayloadProduce{Passthrough: true},
		Output:     "payload unchanged; a sync-summary JSON -> the output attribute, if named",
		Description: "Mirrors every frontmattered markdown file in a folder as a Delivered feature card: a " +
			"file already mirrored keeps its card and only its mirror-owned fields (goal, shipped date, PRs, " +
			"proof) refresh. Your sign-off, verified date, and notes are never touched. A new file becomes " +
			"a new card, pending-verify by default.",
		ConfigFields: []ConfigField{
			{
				Key: "folderPath", Label: "Folder path", Type: FieldText,
				Description: "Folder of frontmattered markdown files to mirror as ledger cards.",
			},
			{
				Key: "parentTitle", Label: "Parent card title", Type: FieldText,
				Description: "Cards land under the card with this title, created if missing. Empty uses the space root.",
			},
			{
				Key: "outputAttribute", Label: "Output attribute (optional)", Type: FieldText,
				Description: "Which Attributes field receives a summary of what changed.",
			},
		},
	}, execAtlasLedgerSync)
}

func execAtlasLedgerSync(node Node, ctx ExecContext) (ExecContext, error) {
	folder := node.Config["folderPath"]
	if folder == "" {
		return ctx, fmt.Errorf("apply-atlas-ledger-sync: folderPath is required")
	}
	summary, err := atlasLedgerSyncFn(folder, node.Config["parentTitle"], currentRunID(ctx.RunContext))
	if err != nil {
		return ctx, fmt.Errorf("apply-atlas-ledger-sync: %w", err)
	}
	if outAttr := node.Config["outputAttribute"]; outAttr != "" {
		if ctx.Attributes == nil {
			ctx.Attributes = map[string]any{}
		}
		ctx.Attributes[outAttr] = summary
	}
	return ctx, nil
}
