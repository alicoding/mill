package mcpsvc

import (
	"context"

	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// atlas_list_contents (docs/goals/0278): the agent door onto the same
// content index the plugin SDK's api.query reads (atlassvc.Contents)
// -- cards, notes, and board objects in one per-kind listing with
// display names. Additive next to atlas_read_board_objects (which
// keeps its locked shape and never listed notes); the index is the
// first place a note is enumerable outside the board.

type atlasListContentsArgs struct {
	Kind     string `json:"kind,omitempty" jsonschema:"optional: one kind -- \"card\", \"note\", or a board object kind (image, ink, shape, table, diagram, sheet, pdf, or a plugin's own); omit for everything"`
	ParentID string `json:"parentId,omitempty" jsonschema:"optional: only entries filed directly under this card; omit for the whole Atlas"`
}

type atlasContentEntryOut struct {
	ID       string                      `json:"id"`
	Kind     string                      `json:"kind"`
	Subkind  string                      `json:"subkind,omitempty"`
	Title    string                      `json:"title"`
	ParentID string                      `json:"parentId,omitempty"`
	Position atlasBoardObjectPositionOut `json:"position"`
	Size     *atlasBoardObjectSizeOut    `json:"size,omitempty"`
	Payload  map[string]string           `json:"payload,omitempty"`
}

type atlasListContentsResult struct {
	Entries []atlasContentEntryOut `json:"entries"`
}

func contentEntriesOut(entries []atlassvc.ContentEntry) atlasListContentsResult {
	out := atlasListContentsResult{Entries: []atlasContentEntryOut{}}
	for _, e := range entries {
		out.Entries = append(out.Entries, atlasContentEntryOut{
			ID: e.ID, Kind: e.Kind, Subkind: e.Subkind, Title: e.Title, ParentID: e.ParentID,
			Position: positionOut(e.Position), Size: sizeOut(e.Size), Payload: e.Payload,
		})
	}
	return out
}

func (m *MillMCPService) registerAtlasContentsTool() {
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "atlas_list_contents",
		Description: "Everything on the Atlas as one per-kind listing with the name a person sees it by: cards " +
			"(title, plus their Kind id as subkind), notes (titled by their first line -- notes have no title " +
			"field, and this is the only tool that lists them), and board objects (image, ink, shape, table, " +
			"diagram, sheet, pdf, plugin kinds; titled by their payload title or kind, payload included). " +
			"Optionally narrowed to one kind and/or one parent card's direct children. Read-only.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in atlasListContentsArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireAtlas(); err != nil {
			return nil, nil, err
		}
		res, err := jsonResult(contentEntriesOut(m.atlas.Contents(atlassvc.ContentsFilter{Kind: in.Kind, ParentID: in.ParentID})))
		return res, nil, err
	})
}
