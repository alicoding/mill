package mcpsvc

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Putting a new object ON the board over MCP (goal 0323): until this
// tool an agent could read every board object and, with goal 0323's
// diagram tools, edit one -- but it could never create one, so a
// diagram it authored had nowhere to land. This closes that, through
// the SAME AtlasService.CreateBoardObject the frontend's own tools
// call, gated by the SAME park every other write here goes through.
//
// Kinds are validated against the nouns Mill itself ships plus every
// kind a turned-on plugin contributes (goal 0324's PluginCatalog
// seam): CreateBoardObject accepts any non-empty kind, so this check
// is what keeps an agent from placing an object nothing can render.
// A plugin the user turned off contributes no kind, so an object of
// its kind cannot be created while it is off.

// contentKindExtensions are the kinds whose whole artifact is text an
// agent can honestly author in one call, and the file extension each
// one's mirror takes. A kind absent here can still be created -- it
// just has to name an existing file through payload.mirrorPath rather
// than carrying its bytes inline.
var contentKindExtensions = map[string]string{
	"diagram": ".drawio",
	"sheet":   ".csv",
}

// fileBackedKinds must end up with a mirrorPath one way or the other:
// either content wrote one, or the caller named an existing file.
var fileBackedKinds = map[string]bool{
	"diagram": true, "image": true, "ink": true, "pdf": true, "sheet": true,
}

// defaultBoardObjectPosition is where an agent-created object lands
// when the caller names no position. The board's own free-placement
// search is frontend logic (it needs the live viewport and the
// rendered footprints of what is already there); this service has no
// reach into it, so it uses one fixed near-origin point and leaves the
// arranging to the person.
var defaultBoardObjectPosition = atlas.Position{X: 80, Y: 80}

type atlasCreateBoardObjectPosition struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type atlasCreateBoardObjectArgs struct {
	Kind     string                          `json:"kind" jsonschema:"the canvas noun to create: diagram, image, ink, pdf, shape, sheet, table, or a kind a plugin contributes (atlas_list_kinds)"`
	Payload  map[string]string               `json:"payload,omitempty" jsonschema:"the object's own fields -- title for any kind, mirrorPath to point a file-backed kind at an existing file, listID for a table, shapeType for a shape"`
	Position *atlasCreateBoardObjectPosition `json:"position,omitempty" jsonschema:"optional: where on the board to place it. Defaults to the top-left of the board area."`
	ParentID string                          `json:"parentId,omitempty" jsonschema:"optional: the card whose canvas this belongs on; omit for the top-level board"`
	Content  string                          `json:"content,omitempty" jsonschema:"optional: the file's own content for a diagram (draw.io XML) or a sheet (CSV). Mill writes it to a new file and points the object at it."`
}

func (a atlasCreateBoardObjectArgs) position() atlas.Position {
	if a.Position == nil {
		return defaultBoardObjectPosition
	}
	return atlas.Position{X: a.Position.X, Y: a.Position.Y}
}

// checkCreateBoardObject answers everything that can be known before
// the write parks, so a call that could never succeed never reaches a
// person's approval queue.
func (m *MillMCPService) checkCreateBoardObject(in atlasCreateBoardObjectArgs) error {
	if err := m.requireWriteEnabled(); err != nil {
		return err
	}
	if err := m.requireAtlas(); err != nil {
		return err
	}
	if !m.creatableBoardObjectKind(in.Kind) {
		return fmt.Errorf("%q is not a canvas object Mill knows -- pick one of: %s",
			in.Kind, strings.Join(m.creatableBoardObjectKinds(), ", "))
	}
	if in.Content != "" && contentKindExtensions[in.Kind] == "" {
		return fmt.Errorf("a %s's content is not text Mill can write -- create it with payload.mirrorPath pointing at an existing file (content is accepted for: diagram, sheet)", in.Kind)
	}
	if in.Content == "" && fileBackedKinds[in.Kind] && in.Payload["mirrorPath"] == "" {
		return fmt.Errorf("a %s needs a file: pass content, or payload.mirrorPath naming one that already exists", in.Kind)
	}
	if in.Kind == "table" && in.Payload["listID"] == "" {
		return fmt.Errorf("a table shows a List: pass payload.listID naming one (see the List index)")
	}
	if in.ParentID != "" {
		if _, err := m.findCardByID(in.ParentID); err != nil {
			return err
		}
	}
	return nil
}

// creatableBoardObjectKinds is every kind this tool accepts right now,
// in the order atlas_list_kinds reports them.
func (m *MillMCPService) creatableBoardObjectKinds() []string {
	kinds := m.boardObjectKinds()
	out := make([]string, 0, len(kinds))
	for _, k := range kinds {
		out = append(out, k.Kind)
	}
	return out
}

func (m *MillMCPService) creatableBoardObjectKind(kind string) bool {
	if atlas.IsBuiltInBoardObjectKind(kind) {
		return true
	}
	if m.plugins == nil {
		return false
	}
	_, ok := m.plugins.CanvasKinds()[kind]
	return ok
}

func (m *MillMCPService) findCardByID(cardID string) (atlas.Card, error) {
	for _, c := range m.atlas.Cards() {
		if c.ID == cardID {
			return c, nil
		}
	}
	return atlas.Card{}, fmt.Errorf("no card with id %q to place this on", cardID)
}

func (m *MillMCPService) executeCreateBoardObject(argsJSON string) (string, error) {
	var in atlasCreateBoardObjectArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return "", err
	}
	payload := make(map[string]string, len(in.Payload)+1)
	for k, v := range in.Payload {
		payload[k] = v
	}
	title := boardObjectTitle(payload, in.Kind)
	payload["title"] = title
	if in.Content != "" {
		path, err := m.atlas.SaveMirrorText(in.Content, contentKindExtensions[in.Kind], title)
		if err != nil {
			return "", err
		}
		payload["mirrorPath"] = path
	}
	o, err := m.atlas.CreateBoardObject(in.Kind, payload, in.position(), in.ParentID)
	if err != nil {
		return "", err
	}
	return jsonText(atlasBoardObjectSummary{
		ID: o.ID, Kind: o.Kind, ParentID: o.ParentID,
		Position: positionOut(o.Position), Size: sizeOut(o.Size),
		Source: m.summarizeBoardObjectSource(o),
	})
}

// boardObjectTitle is what the object is called on the board and what
// its file is named after -- the caller's own title when it gave one,
// otherwise the kind plus the moment it was made, so two agent-created
// diagrams are still tellable apart at a glance.
func boardObjectTitle(payload map[string]string, kind string) string {
	if t := strings.TrimSpace(payload["title"]); t != "" {
		return t
	}
	return fmt.Sprintf("%s-%d", kind, time.Now().Unix())
}

func (m *MillMCPService) registerAtlasCreateObjectTool() {
	m.registerWriteExecutor("atlas_create_board_object", m.executeCreateBoardObject)
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "atlas_create_board_object",
		Description: "Put a new canvas object on the Atlas: a diagram, image, ink, pdf, shape, sheet or " +
			"table, or any kind a turned-on plugin contributes (atlas_list_kinds lists them all). " +
			"A diagram or sheet can carry its content inline -- Mill writes the file and points the " +
			"object at it; every other file-backed kind names a file that already exists through " +
			"payload.mirrorPath. Place it on one card's canvas with parentId, or leave it off for the " +
			"top-level board. " + approvalPollNote,
	}, func(_ context.Context, _ *mcp.CallToolRequest, in atlasCreateBoardObjectArgs) (*mcp.CallToolResult, any, error) {
		if err := m.checkCreateBoardObject(in); err != nil {
			return nil, nil, err
		}
		argsJSON, err := marshalArgs(in)
		if err != nil {
			return nil, nil, err
		}
		res, err := m.gateWrite("atlas_create_board_object",
			fmt.Sprintf("Create a %s on the board", in.Kind), argsJSON)
		return res, nil, err
	})
}
