package mcpsvc

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Board-object visibility over MCP (goal 0179 close-out, ADR-0046): the
// person's Atlas shows five board-object noun types (image, ink, shape,
// table, diagram) beside cards, but before this file zero mcpsvc code
// mentioned BoardObject at all -- an agent reading a board saw only
// cards, the exact assumed-vs-real gap Mill exists to close. These two
// tools are the READ half of ADR-0046's content-plane boundary: a
// board object's own file (file-backed), its projected List
// (provider-backed), or its own Payload (board-local) is content Mill's
// API manages, so it is agent-addressable the same way a Card already
// is. The WRITE half waits on the guardrail request-an-action entry
// (ADR-0047 §5) -- nothing here mutates a board object.
//
// Both tools reuse the exact accessors the Atlas UI's own board-object
// renderer reads from (AtlasService.Objects, ObjectMirrorContent,
// ObjectListProjection) -- no second read model, the same discipline
// atlas_read_card's own header comment states.

// atlasBoardObjectPositionOut/atlasBoardObjectSizeOut give a board
// object's placement/footprint explicit lowercase JSON keys -- the
// domain atlas.Position/Dimensions types carry none, and every other
// wire shape in this package (kindId, parentId, ...) is camelCase.
type atlasBoardObjectPositionOut struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type atlasBoardObjectSizeOut struct {
	W float64 `json:"w"`
	H float64 `json:"h"`
}

func positionOut(p atlas.Position) atlasBoardObjectPositionOut {
	return atlasBoardObjectPositionOut{X: p.X, Y: p.Y}
}

func sizeOut(s *atlas.Dimensions) *atlasBoardObjectSizeOut {
	if s == nil {
		return nil
	}
	return &atlasBoardObjectSizeOut{W: s.W, H: s.H}
}

// boardObjectSourceKind is the three-way split this file's tool
// descriptions promise: a board object's Payload carries at most one of
// "mirrorPath" (file-backed) or "listID" (provider/List-backed) by
// CreateBoardObject's own convention (atlasboardobject.go); anything
// else is board-local, its Payload the whole artifact (ADR-0046's
// `board-local` source term).
func boardObjectSourceKind(o atlas.BoardObject) string {
	switch {
	case o.Payload["mirrorPath"] != "":
		return "file"
	case o.Payload["listID"] != "":
		return "list"
	default:
		return "board-local"
	}
}

// --- atlas_read_board_objects: curated per-object summaries ---

type atlasReadBoardObjectsArgs struct {
	ParentID string `json:"parentId,omitempty" jsonschema:"optional: only board objects filed under this card; omit to list every board object on the Atlas (the same optional parentId scoping atlas_search_cards uses)"`
}

type atlasBoardObjectSourceSummary struct {
	// Type is "file", "list", or "board-local" (ADR-0046's source
	// vocabulary, narrowed to the three kinds a board object's Payload
	// convention can express).
	Type string `json:"type"`
	// file-backed
	MirrorPath string `json:"mirrorPath,omitempty"`
	MimeType   string `json:"mimeType,omitempty"`
	// provider/List-backed
	ListID    string `json:"listId,omitempty"`
	ListLabel string `json:"listLabel,omitempty"`
	// board-local
	Summary string `json:"summary,omitempty"`
}

type atlasBoardObjectSummary struct {
	ID       string                        `json:"id"`
	Kind     string                        `json:"kind"`
	ParentID string                        `json:"parentId,omitempty"`
	Position atlasBoardObjectPositionOut   `json:"position"`
	Size     *atlasBoardObjectSizeOut      `json:"size,omitempty"`
	Source   atlasBoardObjectSourceSummary `json:"source"`
}

type atlasReadBoardObjectsResult struct {
	Objects []atlasBoardObjectSummary `json:"objects"`
}

// summarizeBoardObjectSource builds one object's source summary without
// reading any file/List content -- ClassifyMirrorKind is a pure
// extension-only decision (no I/O), and ObjectListProjection's own read
// is the same cheap in-memory lookup CardListProjection already pays
// per card, so listing many objects stays proportionate to the board's
// size, never its files' bytes.
func (m *MillMCPService) summarizeBoardObjectSource(o atlas.BoardObject) atlasBoardObjectSourceSummary {
	switch boardObjectSourceKind(o) {
	case "file":
		path := o.Payload["mirrorPath"]
		kind := atlas.ClassifyMirrorKind(path)
		mime := ""
		switch kind {
		case atlas.MirrorKindImage:
			mime = atlas.MirrorImageMimeType(path)
		case atlas.MirrorKindSheet:
			mime = atlas.MirrorSheetMimeType(path)
		case atlas.MirrorKindMarkdown, atlas.MirrorKindText, atlas.MirrorKindOther:
			// No MIME type for these -- text/markdown are read as their
			// own kind, "other" never has a MIME type declared at all.
		}
		return atlasBoardObjectSourceSummary{Type: "file", MirrorPath: path, MimeType: mime}
	case "list":
		proj, err := m.atlas.ObjectListProjection(o.ID)
		if err != nil || proj.Missing {
			return atlasBoardObjectSourceSummary{Type: "list", ListID: o.Payload["listID"]}
		}
		return atlasBoardObjectSourceSummary{Type: "list", ListID: proj.ListID, ListLabel: proj.Label}
	default:
		return atlasBoardObjectSourceSummary{Type: "board-local", Summary: summarizeBoardLocalPayload(o.Payload)}
	}
}

// summarizeBoardLocalPayload is this file's own short-excerpt builder
// for a board-local object's Payload (the same "enough to recognize
// without the full body" spirit atlasNoteSnippet already applies to a
// card's note) -- kind-agnostic, so a not-yet-seen board-local Kind
// still summarizes instead of reporting nothing: a "text" value (a
// future sticky's jot) wins outright, a "shapeType" value (today's
// shape kind) reports as "<type> shape", and anything else falls back
// to a sorted key=value join of every non-empty Payload entry.
func summarizeBoardLocalPayload(payload map[string]string) string {
	const maxLen = 200
	if len(payload) == 0 {
		return ""
	}
	if text := payload["text"]; text != "" {
		return truncateBoardObjectSummary(text, maxLen)
	}
	if shapeType := payload["shapeType"]; shapeType != "" {
		return truncateBoardObjectSummary(shapeType+" shape", maxLen)
	}
	keys := make([]string, 0, len(payload))
	for k := range payload {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		if payload[k] == "" {
			continue
		}
		parts = append(parts, k+"="+payload[k])
	}
	return truncateBoardObjectSummary(strings.Join(parts, ", "), maxLen)
}

func truncateBoardObjectSummary(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "…"
}

func (m *MillMCPService) readBoardObjects(parentID string) atlasReadBoardObjectsResult {
	result := atlasReadBoardObjectsResult{Objects: []atlasBoardObjectSummary{}}
	for _, o := range m.atlas.Objects() {
		if parentID != "" && o.ParentID != parentID {
			continue
		}
		result.Objects = append(result.Objects, atlasBoardObjectSummary{
			ID: o.ID, Kind: o.Kind, ParentID: o.ParentID,
			Position: positionOut(o.Position), Size: sizeOut(o.Size),
			Source: m.summarizeBoardObjectSource(o),
		})
	}
	sort.Slice(result.Objects, func(i, j int) bool { return result.Objects[i].ID < result.Objects[j].ID })
	return result
}

// --- atlas_read_board_object: the full per-kind content read ---

type atlasReadBoardObjectArgs struct {
	ObjectID string `json:"objectId" jsonschema:"the board object's ID (from atlas_read_board_objects)"`
}

type atlasBoardObjectListColumnOut struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Type  string `json:"type"`
}

type atlasBoardObjectListRowOut struct {
	ID     string            `json:"id"`
	Status string            `json:"status,omitempty"`
	Values map[string]string `json:"values"`
}

type atlasBoardObjectContentOut struct {
	ID       string                      `json:"id"`
	Kind     string                      `json:"kind"`
	ParentID string                      `json:"parentId,omitempty"`
	Position atlasBoardObjectPositionOut `json:"position"`
	Size     *atlasBoardObjectSizeOut    `json:"size,omitempty"`
	Source   string                      `json:"source"`

	// file-backed
	MirrorPath string `json:"mirrorPath,omitempty"`
	MimeType   string `json:"mimeType,omitempty"`
	FileSize   int64  `json:"fileSize,omitempty"`
	Content    string `json:"content,omitempty"`
	Missing    bool   `json:"missing,omitempty"`
	TooLarge   bool   `json:"tooLarge,omitempty"`

	// provider/List-backed
	ListID      string                          `json:"listId,omitempty"`
	ListLabel   string                          `json:"listLabel,omitempty"`
	ListMissing bool                            `json:"listMissing,omitempty"`
	Columns     []atlasBoardObjectListColumnOut `json:"columns,omitempty"`
	Rows        []atlasBoardObjectListRowOut    `json:"rows,omitempty"`

	// board-local
	Payload map[string]string `json:"payload,omitempty"`
}

func (m *MillMCPService) findBoardObject(objectID string) (atlas.BoardObject, error) {
	for _, o := range m.atlas.Objects() {
		if o.ID == objectID {
			return o, nil
		}
	}
	return atlas.BoardObject{}, fmt.Errorf("no board object with id %q", objectID)
}

// readBoardObject builds atlas_read_board_object's full per-kind
// content: file-backed reuses ObjectMirrorContent (the exact door the
// board's own file-backed renderers read through) but WITHHOLDS its
// base64 bytes for an image/sheet -- an agent gets the mime type, byte
// size, and path to act on, never an inline binary blob; a text/
// markdown mirror's Content already IS text, so it rides through
// unchanged. List-backed reuses ObjectListProjection (the same door a
// table board object's own face already reads through) verbatim.
// Board-local returns the object's whole Payload -- there is no other
// content plane for it to read from.
func (m *MillMCPService) readBoardObject(objectID string) (atlasBoardObjectContentOut, error) {
	o, err := m.findBoardObject(objectID)
	if err != nil {
		return atlasBoardObjectContentOut{}, err
	}
	out := atlasBoardObjectContentOut{
		ID: o.ID, Kind: o.Kind, ParentID: o.ParentID,
		Position: positionOut(o.Position), Size: sizeOut(o.Size),
		Source: boardObjectSourceKind(o),
	}
	switch out.Source {
	case "file":
		if err := m.fillFileBackedContent(&out, o); err != nil {
			return atlasBoardObjectContentOut{}, err
		}
	case "list":
		m.fillListBackedContent(&out, o)
	default:
		out.Payload = o.Payload
	}
	return out, nil
}

func (m *MillMCPService) fillFileBackedContent(out *atlasBoardObjectContentOut, o atlas.BoardObject) error {
	out.MirrorPath = o.Payload["mirrorPath"]
	mc, err := m.atlas.ObjectMirrorContent(o.ID)
	if err != nil {
		return err
	}
	out.FileSize, out.Missing, out.TooLarge = mc.Size, mc.Missing, mc.TooLarge
	switch mc.Kind {
	case atlas.MirrorKindImage, atlas.MirrorKindSheet:
		// Withhold Content deliberately (this tool's own contract) --
		// mc.Content is base64 bytes meant for a browser <img>/parser,
		// never for an agent's context window.
		out.MimeType = mc.MimeType
	case atlas.MirrorKindMarkdown, atlas.MirrorKindText:
		out.Content = mc.Content
	case atlas.MirrorKindOther:
		// No MIME type and no content -- same as the overlay's own
		// type+size+reveal fallback (mirrorContentForPath's contract).
	}
	return nil
}

func (m *MillMCPService) fillListBackedContent(out *atlasBoardObjectContentOut, o atlas.BoardObject) {
	out.ListID = o.Payload["listID"]
	proj, err := m.atlas.ObjectListProjection(o.ID)
	if err != nil || proj.Missing {
		out.ListMissing = true
		return
	}
	out.ListID, out.ListLabel = proj.ListID, proj.Label
	out.Columns = make([]atlasBoardObjectListColumnOut, 0, len(proj.Columns))
	for _, c := range proj.Columns {
		out.Columns = append(out.Columns, atlasBoardObjectListColumnOut{Key: c.Key, Label: c.Label, Type: c.Type})
	}
	out.Rows = make([]atlasBoardObjectListRowOut, 0, len(proj.Rows))
	for _, r := range proj.Rows {
		out.Rows = append(out.Rows, atlasBoardObjectListRowOut{ID: r.ID, Status: r.Status, Values: r.Values})
	}
}

// registerAtlasBoardObjectTools wires the two board-object read tools
// beside atlas_list_kinds/atlas_search_cards/atlas_read_card -- called
// from registerAtlasTools (millmcpservice_atlas.go). Both are
// read-only and ungated, same tier as the card read tools: a board
// object's WRITE surface waits on the guardrail request-an-action entry
// (ADR-0047 §5), never this file.
func (m *MillMCPService) registerAtlasBoardObjectTools() {
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "atlas_read_board_objects",
		Description: "Every board object on the Atlas (the non-card canvas nouns: image, ink, shape, table, diagram) " +
			"and how the person sees them -- id, kind, parent, position/size, and an honest source summary: a " +
			"file-backed object (image/ink/diagram) reports its mirrored file's path and MIME type; a List-backed " +
			"object (table) reports the List's id and label; a board-local object (shape) reports a short summary " +
			"of its own payload. Optionally scoped to one parent card's direct children. Read-only.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in atlasReadBoardObjectsArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireAtlas(); err != nil {
			return nil, nil, err
		}
		res, err := jsonResult(m.readBoardObjects(in.ParentID))
		return res, nil, err
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name: "atlas_read_board_object",
		Description: "One board object's full content, by kind: a file-backed object (image/ink/diagram) returns " +
			"its mirrored file's path, MIME type and byte size, plus the file's own text content when it's a text " +
			"format (drawio XML, mermaid source, CSV) -- an image or binary spreadsheet reports its MIME type and " +
			"size only, never inline bytes. A List-backed object (table) returns the projected List's id, label, " +
			"columns and rows -- the same live data the table's own board face renders. A board-local object " +
			"(shape) returns its full payload. Read-only.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in atlasReadBoardObjectArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireAtlas(); err != nil {
			return nil, nil, err
		}
		out, err := m.readBoardObject(in.ObjectID)
		if err != nil {
			return nil, nil, err
		}
		res, err := jsonResult(out)
		return res, nil, err
	})
}
