package composition

import (
	"fmt"

	"github.com/alicoding/mill/internal/adapters/fileread"
	"github.com/alicoding/mill/internal/domain/guardrail"
)

// Package-level function var, not a direct call -- same testability
// pattern as capture.go's readClipboardHTML/readClipboardText.
var readFile = fileread.Read

func init() {
	RegisterNodeType(NodeType{
		ID: "capture-file", Kind: KindCapture,
		Effect:      guardrail.ClassRead,
		Complexity:  ComplexityBasic,
		Output:      "the file's contents",
		Label:       "Read file",
		Description: "Reads a local file into the payload. \"payload\" source treats the CURRENT payload as the file path (what a filesystem-watch trigger's changed-path output supplies, docs/SPEC.md §3.4); \"literal\" source reads a fixed path instead.",
		ConfigFields: []ConfigField{
			{
				Key: "source", Label: "Path source", Type: FieldOptions,
				Description: "\"payload\" reads the path from the upstream payload (a filesystem-watch trigger's changed path); \"literal\" reads the fixed path below instead.",
				Default:     "payload", Options: []string{"payload", "literal"},
			},
			{
				Key: "path", Label: "Path",
				Description: "The file path to read when \"Path source\" is literal. Ignored when source is payload.",
				Default:     "", Type: FieldText,
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		path := ctx.Payload
		if node.Config["source"] == "literal" {
			path = node.Config["path"]
		} else if path == "" {
			// The step's own most common failure, made self-explanatory
			// (docs/SPEC.md §1's thesis): a manual test run starts with an
			// empty payload unless one is supplied, so payload-as-path has
			// nothing to read.
			return ctx, fmt.Errorf("capture-file: the payload is empty, so there is no file path to read -- " +
				"this step expects an upstream trigger (e.g. filesystem watch) to supply the path; " +
				"on a manual test run, fill in the Run dialog's Initial payload with a file path, " +
				"or set this step's Path source to \"literal\" with a fixed path")
		}
		content, err := readFile(path)
		if err != nil {
			return ctx, err
		}
		ctx.Payload = content
		return ctx, nil
	})
}
