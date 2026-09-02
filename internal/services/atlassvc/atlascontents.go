package atlassvc

import (
	"sort"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// The content index (docs/goals/0278): ONE unified, per-kind listing
// of everything on the board -- cards, notes, and board objects --
// serving two doors from a single implementation: the bound
// ListContents (the plugin SDK's api.query and the Contents view) and
// the MCP atlas_list_contents tool. Notes had no listing door at all
// before this (they are their own entity, never a board object), so
// this is the first place a note is enumerable outside the board.

// ContentKindCard and ContentKindNote are the two non-object kinds in
// the index's vocabulary; every other Kind is a board object's own.
const (
	ContentKindCard = "card"
	ContentKindNote = "note"
)

// ContentEntry is the index's one envelope. Title is the display
// name (a card's title; a note's derived first line, never stored --
// atlas.NoteDisplayName; an object's payload title, else its kind).
// Subkind carries a card's Atlas Kind id (a note or object has none).
// Payload is a board object's own payload, and {"text": …} for a
// note; a card's fields are deliberately NOT here (agents read them
// through atlas_read_card; the plugin-side question is recorded on
// goal 0261's remaining list).
type ContentEntry struct {
	ID       string
	Kind     string
	Subkind  string
	Title    string
	ParentID string
	Position atlas.Position
	Size     *atlas.Dimensions
	Payload  map[string]string
}

// ContentsFilter narrows the index: Kind to one kind ("card", "note",
// or an object kind), ParentID to one parent's direct children. Empty
// means everything.
type ContentsFilter struct {
	Kind     string
	ParentID string
}

// Contents lists live entries matching filter, sorted by kind then
// title then id -- a stable order every door shares.
func (a *AtlasService) Contents(filter ContentsFilter) []ContentEntry {
	out := []ContentEntry{}
	for _, e := range a.contentEntries() {
		if filter.matches(e) {
			out = append(out, e)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return out[i].Kind < out[j].Kind
		}
		if out[i].Title != out[j].Title {
			return out[i].Title < out[j].Title
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func (f ContentsFilter) matches(e ContentEntry) bool {
	if f.Kind != "" && e.Kind != f.Kind {
		return false
	}
	return f.ParentID == "" || e.ParentID == f.ParentID
}

// contentEntries is the unfiltered index: every live card, note, and
// object restated as an entry.
func (a *AtlasService) contentEntries() []ContentEntry {
	cards, notes, objects := a.Cards(), a.Notes(), a.Objects()
	out := make([]ContentEntry, 0, len(cards)+len(notes)+len(objects))
	for _, c := range cards {
		out = append(out, cardEntry(c))
	}
	for _, n := range notes {
		out = append(out, noteEntry(n))
	}
	for _, o := range objects {
		out = append(out, objectEntry(o))
	}
	return out
}

func cardEntry(c atlas.Card) ContentEntry {
	pos := atlas.Position{}
	if c.Position != nil {
		pos = *c.Position
	}
	return ContentEntry{ID: c.ID, Kind: ContentKindCard, Subkind: c.KindID, Title: c.Title, ParentID: c.ParentID, Position: pos, Size: c.Size}
}

func noteEntry(n atlas.Note) ContentEntry {
	return ContentEntry{ID: n.ID, Kind: ContentKindNote, Title: atlas.NoteDisplayName(n.Text), ParentID: n.ParentID, Position: n.Position, Size: n.Size, Payload: map[string]string{"text": n.Text}}
}

func objectEntry(o atlas.BoardObject) ContentEntry {
	title := o.Payload["title"]
	if title == "" {
		title = o.Kind
	}
	payload := map[string]string{}
	for k, v := range o.Payload {
		payload[k] = v
	}
	return ContentEntry{ID: o.ID, Kind: o.Kind, Title: title, ParentID: o.ParentID, Position: o.Position, Size: o.Size, Payload: payload}
}

// ListContents is the Wails-bound door onto Contents (plugin SDK
// api.query, the Contents view). Never nil.
func (a *AtlasService) ListContents(kind, parentID string) []ContentEntry {
	return a.Contents(ContentsFilter{Kind: kind, ParentID: parentID})
}
