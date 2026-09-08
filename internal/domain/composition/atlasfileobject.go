package composition

import (
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/domain/guardrail"
)

// AtlasFileObjectResult is what landing (or matching) one downloaded
// file as a board object reports back -- the composition-side twin of
// atlassvc.FileObjectResult (the seam boundary, .claude/rules/backend.md:
// this package never imports atlassvc directly).
type AtlasFileObjectResult struct {
	ObjectID string
	Note     string
}

// atlasFileObjectCreateFn lands one download's own bytes as a board
// object -- injected the same way atlasCardCreateFn is. Defaults to
// erroring so a node run before SetAtlasFileObjectCreator is wired
// fails loudly rather than silently doing nothing.
var atlasFileObjectCreateFn = func(_, filename, _ string) (AtlasFileObjectResult, error) {
	return AtlasFileObjectResult{}, fmt.Errorf("no atlas file-object creator registered (yet) for %q", filename)
}

// SetAtlasFileObjectCreator wires the function apply-atlas-file-object
// nodes use to land one download. Called once from main.go once
// AtlasService exists.
func SetAtlasFileObjectCreator(fn func(base64Data, filename, sourceRunID string) (AtlasFileObjectResult, error)) {
	atlasFileObjectCreateFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "apply-atlas-file-object", Kind: KindApply,
		// ClassLocal: writes to Atlas's own persisted store, the same
		// classification apply-atlas-card-create carries. The browser
		// already drove the live site (process-browser-replay's own
		// ClassExternal, which produced this payload) -- landing what
		// it already brought back is a local write, the operation-merge
		// rule keeping the more restrictive verdict per step, not this
		// one borrowing the other's.
		Effect:     guardrail.ClassLocal,
		Complexity: ComplexityBasic,
		Consumes:   []PayloadKind{PayloadJSON},
		Produces:   PayloadProduce{Passthrough: true},
		Output:     "the same steps/extracted/downloads document, each download's own landing outcome added",
		Label:      "Land downloads on the board",
		Description: "Turns every download a browser-replay step brought back into a file-backed board object, " +
			"mirror-checksummed so a file already landed before is matched, never duplicated.",
	}, execAtlasFileObject)
}

// atlasFileObjectOutput is this step's own result document: the
// browser-replay payload it received, with each download's own landing
// outcome joined in. Steps/Extracted travel through unchanged -- this
// step never touched the page, only what the earlier step brought
// back.
type atlasFileObjectOutput struct {
	Steps     []browserReplayOutputStep `json:"steps"`
	Extracted map[string]string         `json:"extracted"`
	Downloads []atlasFileObjectDownload `json:"downloads"`
}

// atlasFileObjectDownload is one download's outcome: the browser's own
// report (Path/Filename/Bytes) plus what this step did with it. Data
// never rides along -- the bytes are on the board now (a real file, or
// an existing object's), not worth re-carrying through every later
// step's checkpointed input.
type atlasFileObjectDownload struct {
	Path     string `json:"path"`
	Filename string `json:"filename,omitempty"`
	Bytes    int64  `json:"bytes"`
	ObjectID string `json:"objectId,omitempty"`
	Note     string `json:"note,omitempty"`
}

func execAtlasFileObject(_ Node, ctx ExecContext) (ExecContext, error) {
	var in browserReplayOutput
	if err := json.Unmarshal([]byte(ctx.Payload), &in); err != nil {
		return ctx, fmt.Errorf("apply-atlas-file-object: reading the browser-replay result: %w", err)
	}

	sourceRunID := currentRunID(ctx.RunContext)
	out := atlasFileObjectOutput{
		Steps: in.Steps, Extracted: in.Extracted,
		Downloads: make([]atlasFileObjectDownload, 0, len(in.Downloads)),
	}
	for _, d := range in.Downloads {
		out.Downloads = append(out.Downloads, landDownload(d, sourceRunID))
	}

	encoded, err := json.Marshal(out)
	if err != nil {
		return ctx, fmt.Errorf("apply-atlas-file-object: %w", err)
	}
	ctx.Payload = string(encoded)
	return ctx, nil
}

// landDownload resolves one download's own outcome: too large to have
// crossed the bridge at all, no bytes for some other reason, or a real
// attempt at landing it, which itself may create, match a duplicate, or
// fail.
func landDownload(d browserbridge.Download, sourceRunID string) atlasFileObjectDownload {
	base := atlasFileObjectDownload{Path: d.Path, Filename: d.Filename, Bytes: d.Bytes}
	if d.TooLarge {
		base.Note = fmt.Sprintf("Too large to keep with the run; the file is at %s.", d.Path)
		return base
	}
	if d.Data == "" {
		return base
	}
	result, err := atlasFileObjectCreateFn(d.Data, d.Filename, sourceRunID)
	if err != nil {
		base.Note = err.Error()
		return base
	}
	base.ObjectID = result.ObjectID
	base.Note = result.Note
	return base
}
