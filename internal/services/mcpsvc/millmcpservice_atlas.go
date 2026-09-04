package mcpsvc

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Atlas over MCP (goal 0083, docs/adr/0038): an external agent's own
// read/write surface onto Mill's Atlas, the second half of "what-you-
// see-is-what-I-see" -- an Atlas card IS the shared record between a
// human and an agent, not an agent's private copy. Reads
// (atlas_list_kinds/atlas_search_cards/atlas_read_card, plus the
// mill://atlas/cards resource, this file) call
// the SAME exported AtlasService accessors the UI itself reads from,
// never a second read model (the same discipline every other mcpsvc
// resource/tool in this package already follows for compositionsvc/
// configuresvc). The one write tool, atlas_propose_card_write, parks
// through the EXISTING ADR-0032 pending-write plane
// (millmcpservice_atlas_write.go) -- never a parallel gate, ADR-0035.
//
// SetAtlasService late-binds the same way SetExecutionService does
// (millmcpservice_authoring.go): main.go constructs AtlasService before
// MillMCPService, but the setter call still happens after
// NewMillMCPService returns, so every handler below reads m.atlas at
// CALL time, not at registration time.

// SetAtlasService late-binds the Atlas surface for atlas_*
// tools/resources -- mcpsvc is not a Wails-bound service, so no
// //wails:ignore is needed (SetExecutionService's own doc comment).
func (m *MillMCPService) SetAtlasService(a *atlassvc.AtlasService) { m.atlas = a }

func (m *MillMCPService) requireAtlas() error {
	if m.atlas == nil {
		return fmt.Errorf("atlas service not wired")
	}
	return nil
}

// resolvePerspective looks up nameOrID against m.atlas.Perspectives(),
// by id first (exact) then by Name (case-insensitive) -- the same
// either-works contract atlas_search_cards/atlas_read_card's own
// `perspective` param documents (goal 0095 slice 3).
func (m *MillMCPService) resolvePerspective(nameOrID string) (atlas.Perspective, error) {
	all := m.atlas.Perspectives()
	for _, p := range all {
		if p.ID == nameOrID {
			return p, nil
		}
	}
	for _, p := range all {
		if strings.EqualFold(p.Name, nameOrID) {
			return p, nil
		}
	}
	return atlas.Perspective{}, fmt.Errorf("no perspective named or with id %q", nameOrID)
}

// --- wire shapes (goal 0083's locked read contract) ---

type atlasKindFieldOut struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Type  string `json:"type"`
}

type atlasLinkKindOut struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type atlasKindOut struct {
	ID          string              `json:"id"`
	Name        string              `json:"name"`
	Description string              `json:"description,omitempty"`
	Fields      []atlasKindFieldOut `json:"fields"`
}

type atlasListKindsResult struct {
	Kinds     []atlasKindOut     `json:"kinds"`
	LinkKinds []atlasLinkKindOut `json:"linkKinds"`
	// BoardObjectKinds (goal 0324) are the canvas nouns
	// atlas_create_board_object accepts -- Mill's own, plus every kind
	// a turned-on plugin contributes, each saying where it came from.
	BoardObjectKinds []atlasBoardKindOut `json:"boardObjectKinds"`
}

// atlasBoardKindOut is one creatable canvas noun. Source is empty for
// Mill's own kinds and "plugin:<pluginId>" for a contributed one.
type atlasBoardKindOut struct {
	Kind   string `json:"kind"`
	Source string `json:"source,omitempty"`
}

type atlasSearchMatch struct {
	ID       string `json:"id"`
	KindID   string `json:"kindId"`
	Title    string `json:"title"`
	Snippet  string `json:"snippet,omitempty"`
	ParentID string `json:"parentId,omitempty"`
}

type atlasSearchCardsArgs struct {
	Query    string `json:"query" jsonschema:"the search text -- case-insensitive substring match over the card's title, note, and every field value"`
	KindID   string `json:"kindId,omitempty" jsonschema:"optional: only cards of this Kind (see atlas_list_kinds for IDs)"`
	ParentID string `json:"parentId,omitempty" jsonschema:"optional: only direct children of this card"`
	// Perspective (goal 0095 slice 3, ADR-0041) is additive: omitted,
	// search covers every card exactly as before.
	Perspective string `json:"perspective,omitempty" jsonschema:"optional: a perspective's name or id -- only cards that perspective shows are searched"`
}

type atlasSearchCardsResult struct {
	Matches []atlasSearchMatch `json:"matches"`
}

type atlasChainEntry struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type atlasChildEntry struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	KindID string `json:"kindId"`
}

type atlasLinkEntry struct {
	LinkID      string `json:"linkId"`
	Direction   string `json:"direction"` // "outgoing" | "incoming"
	LinkKindID  string `json:"linkKindId"`
	OtherCardID string `json:"otherCardId"`
	OtherTitle  string `json:"otherTitle"`
	Label       string `json:"label,omitempty"`
}

type atlasCardOut struct {
	ID          string            `json:"id"`
	KindID      string            `json:"kindId"`
	Title       string            `json:"title"`
	Note        string            `json:"note,omitempty"`
	Summary     string            `json:"summary,omitempty"`
	Status      string            `json:"status,omitempty"`
	Fields      map[string]string `json:"fields,omitempty"`
	SourceURL   string            `json:"sourceURL,omitempty"`
	MirrorPath  string            `json:"mirrorPath,omitempty"`
	ParentChain []atlasChainEntry `json:"parentChain"`
	Children    []atlasChildEntry `json:"children"`
	Links       []atlasLinkEntry  `json:"links"`
}

type atlasReadCardArgs struct {
	CardID string `json:"cardId" jsonschema:"the card's ID (from atlas_search_cards, or the mill://atlas/cards resource)"`
	// Perspective (goal 0095 slice 3, ADR-0041) is additive: omitted,
	// Children/Links cover every card/link exactly as before.
	Perspective string `json:"perspective,omitempty" jsonschema:"optional: a perspective's name or id -- scopes the returned Children and Links to only what that perspective shows; the card must itself be one of its members"`
}

// registerAtlasResources wires mill://atlas/cards -- one read-only
// listing beside the rest of the mill:// resources family (goal 0083's
// locked design), same "index resource is enough to discover IDs, a
// tool carries the full read" split every other family here already
// uses. Called once from NewMillMCPService.
func (m *MillMCPService) registerAtlasResources() {
	m.server.AddResource(&mcp.Resource{
		URI: "mill://atlas/cards", Name: "atlas-cards", MIMEType: "application/json",
		Description: "Every Atlas card's ID, KindID, Title, and ParentID -- read atlas_read_card for one card's full content, links, and containment chain.",
	}, m.readAtlasCardsIndex)
}

type atlasCardIndexEntry struct {
	ID       string `json:"id"`
	KindID   string `json:"kindId"`
	Title    string `json:"title"`
	ParentID string `json:"parentId,omitempty"`
}

func (m *MillMCPService) readAtlasCardsIndex(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	if err := m.requireAtlas(); err != nil {
		return nil, err
	}
	cards := m.atlas.Cards()
	out := make([]atlasCardIndexEntry, 0, len(cards))
	for _, c := range cards {
		out = append(out, atlasCardIndexEntry{ID: c.ID, KindID: c.KindID, Title: c.Title, ParentID: c.ParentID})
	}
	return jsonContents(req.Params.URI, out)
}

// registerAtlasTools wires the atlas_* tool family: three read-only,
// ungated introspection/search/read tools plus the guarded write pair
// (atlas_propose_card_write/atlas_get_write_status,
// millmcpservice_atlas_write.go). Called from registerTools alongside
// the other tool tiers.
func (m *MillMCPService) registerAtlasTools() {
	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "atlas_list_kinds",
		Description: "The Atlas's declared card types and link types: every Kind's ID/name/description/declared fields (key/label/type), and every LinkKind's ID/name -- plus boardObjectKinds, every canvas noun atlas_create_board_object accepts, with source \"plugin:<pluginId>\" on the ones a plugin contributes. Read this before atlas_propose_card_write -- a card's KindID and its Fields keys must match a declared Kind exactly. Read-only.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		if err := m.requireAtlas(); err != nil {
			return nil, nil, err
		}
		res, err := jsonResult(m.listAtlasKinds())
		return res, nil, err
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "atlas_search_cards",
		Description: "Search Atlas cards by a case-insensitive substring match over title, note, and every field value (the same matching a human's own Atlas jump search uses). Optionally scope to one Kind, one parent card, or one perspective's own members. Read-only.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in atlasSearchCardsArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireAtlas(); err != nil {
			return nil, nil, err
		}
		var persp *atlas.Perspective
		if in.Perspective != "" {
			p, err := m.resolvePerspective(in.Perspective)
			if err != nil {
				return nil, nil, err
			}
			persp = &p
		}
		res, err := jsonResult(m.searchAtlasCards(in, persp))
		return res, nil, err
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "atlas_read_card",
		Description: "One card's full content: title, note, summary/status (when its Kind declares those fields), every field value, source URL, mirror path, its containment chain (parent then grandparent... root-ward), its direct children, and every link touching it in both directions (with the other card's ID/title); optionally scoped to one perspective's own members. Read-only.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in atlasReadCardArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireAtlas(); err != nil {
			return nil, nil, err
		}
		var persp *atlas.Perspective
		if in.Perspective != "" {
			p, err := m.resolvePerspective(in.Perspective)
			if err != nil {
				return nil, nil, err
			}
			persp = &p
		}
		out, err := m.readAtlasCard(in.CardID, persp)
		if err != nil {
			return nil, nil, err
		}
		res, err := jsonResult(out)
		return res, nil, err
	})

	m.registerAtlasBoardObjectTools()
	m.registerAtlasDiagramTools()
	m.registerAtlasContentsTool()
	m.registerAtlasWriteTools()
	m.registerAuthoringExtTools()
}

// listAtlasKinds builds atlas_list_kinds' result from the same exported
// AtlasService accessors the Atlas UI's own Kind editor reads.
func (m *MillMCPService) listAtlasKinds() atlasListKindsResult {
	kinds := m.atlas.Kinds()
	out := atlasListKindsResult{Kinds: make([]atlasKindOut, 0, len(kinds)), LinkKinds: []atlasLinkKindOut{}}
	for _, k := range kinds {
		fields := make([]atlasKindFieldOut, 0, len(k.Fields))
		for _, f := range k.Fields {
			fields = append(fields, atlasKindFieldOut{Key: f.Key, Label: f.Label, Type: string(f.Type)})
		}
		out.Kinds = append(out.Kinds, atlasKindOut{ID: k.ID, Name: k.Label, Description: k.Description, Fields: fields})
	}
	for _, lk := range m.atlas.LinkKinds() {
		out.LinkKinds = append(out.LinkKinds, atlasLinkKindOut{ID: lk.ID, Name: lk.Label})
	}
	out.BoardObjectKinds = m.boardObjectKinds()
	return out
}

// boardObjectKinds is every kind atlas_create_board_object will accept
// right now: Mill's own nouns, then each turned-on plugin's, sorted
// within each group so the list reads the same on every call.
func (m *MillMCPService) boardObjectKinds() []atlasBoardKindOut {
	out := []atlasBoardKindOut{}
	for _, k := range atlas.BuiltInBoardObjectKinds() {
		out = append(out, atlasBoardKindOut{Kind: k})
	}
	if m.plugins == nil {
		return out
	}
	contributed := m.plugins.CanvasKinds()
	kinds := make([]string, 0, len(contributed))
	for k := range contributed {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)
	for _, k := range kinds {
		out = append(out, atlasBoardKindOut{Kind: k, Source: pluginSourceLabel(contributed[k])})
	}
	return out
}

// atlasNoteSnippet trims note down to a short excerpt around q's first
// occurrence (or the note's own start, when the match wasn't in the
// note itself) -- the same "enough context to recognize the match
// without the full body" a search result row needs. maxLen keeps a
// tool result from embedding an entire long note as every match's
// snippet.
func atlasNoteSnippet(note, q string) string {
	const maxLen = 160
	if note == "" {
		return ""
	}
	if len(note) <= maxLen {
		return note
	}
	lower := strings.ToLower(note)
	idx := strings.Index(lower, strings.ToLower(q))
	if idx < 0 {
		return note[:maxLen] + "…"
	}
	start := idx - maxLen/2
	if start < 0 {
		start = 0
	}
	end := start + maxLen
	if end > len(note) {
		end = len(note)
		start = end - maxLen
		if start < 0 {
			start = 0
		}
	}
	snippet := note[start:end]
	if start > 0 {
		snippet = "…" + snippet
	}
	if end < len(note) {
		snippet += "…"
	}
	return snippet
}

// searchAtlasCards is atlas_search_cards' own matcher -- Atlas's ⌘K
// jump dialog (frontend/src/atlas/atlasJumpFilter.ts) only ever matches
// title+note and runs entirely client-side (no server-side search
// exists for it to reuse); this is a fresh Go matcher, deliberately
// extended to also match field VALUES (goal 0083's own wider contract:
// "title+note+summary+fields is sufficient"), since summary/status live
// inside a card's Fields map -- there is no separate Card.Summary/
// Card.Status column (internal/domain/atlas/card.go), so matching every
// field value is what makes summary/status searchable at all.
func (m *MillMCPService) searchAtlasCards(in atlasSearchCardsArgs, persp *atlas.Perspective) atlasSearchCardsResult {
	q := strings.ToLower(strings.TrimSpace(in.Query))
	result := atlasSearchCardsResult{Matches: []atlasSearchMatch{}}
	if q == "" {
		return result
	}
	cards := m.atlas.Cards()
	if persp != nil {
		cards, _ = atlas.FilterByPerspective(cards, nil, *persp)
	}
	for _, c := range cards {
		if in.KindID != "" && c.KindID != in.KindID {
			continue
		}
		if in.ParentID != "" && c.ParentID != in.ParentID {
			continue
		}
		matched := strings.Contains(strings.ToLower(c.Title), q) || strings.Contains(strings.ToLower(c.Note), q)
		if !matched {
			for _, v := range c.Fields {
				if strings.Contains(strings.ToLower(v), q) {
					matched = true
					break
				}
			}
		}
		if !matched {
			continue
		}
		result.Matches = append(result.Matches, atlasSearchMatch{
			ID: c.ID, KindID: c.KindID, Title: c.Title, Snippet: atlasNoteSnippet(c.Note, in.Query), ParentID: c.ParentID,
		})
	}
	sort.Slice(result.Matches, func(i, j int) bool {
		if result.Matches[i].Title != result.Matches[j].Title {
			return result.Matches[i].Title < result.Matches[j].Title
		}
		return result.Matches[i].ID < result.Matches[j].ID
	})
	return result
}

// readAtlasCard is atlas_read_card's own logic: resolves the card, its
// parent chain root-ward, its direct children, and every link touching
// it in both directions -- all from AtlasService's plain exported
// accessors (Cards/Links/LinkKinds), the same read model the Atlas UI's
// own overlay/context-block renderer (atlasservice_share.go) draws
// from, just reshaped for an MCP client instead of a paste-ready text
// block.
func (m *MillMCPService) readAtlasCard(cardID string, persp *atlas.Perspective) (atlasCardOut, error) {
	cards := m.atlas.Cards()
	links := m.atlas.Links()
	byID := make(map[string]atlas.Card, len(cards))
	for _, c := range cards {
		byID[c.ID] = c
	}
	card, ok := byID[cardID]
	if !ok {
		return atlasCardOut{}, fmt.Errorf("no card with id %q", cardID)
	}

	// Perspective scoping (goal 0095 slice 3): Children/Links narrow to
	// what persp shows; ParentChain stays the full ancestry regardless
	// (a member's ancestors are already members too, ADR-0041's
	// ancestry-closure invariant, so this is never a real divergence).
	visibleCards, visibleLinks := cards, links
	if persp != nil {
		visibleCards, visibleLinks = atlas.FilterByPerspective(cards, links, *persp)
		member := false
		for _, c := range visibleCards {
			if c.ID == cardID {
				member = true
				break
			}
		}
		if !member {
			return atlasCardOut{}, fmt.Errorf("card %q is not a member of perspective %q", cardID, persp.Name)
		}
	}

	out := atlasCardOut{
		ID: card.ID, KindID: card.KindID, Title: card.Title, Note: card.Note,
		Fields: card.Fields, SourceURL: card.Source, MirrorPath: card.MirrorPath,
		ParentChain: []atlasChainEntry{}, Children: []atlasChildEntry{}, Links: []atlasLinkEntry{},
	}
	if card.Fields != nil {
		out.Summary = card.Fields["summary"]
		out.Status = card.Fields["status"]
	}

	// Parent chain, root-ward (root first, immediate parent last) --
	// mirrors frontend/src/atlas/atlasGrouping.ts's buildBreadcrumbPath
	// ordering (its own unshift-per-step loop), the direct precedent for
	// "what root-ward means" in this codebase. Cycle-guarded the same
	// way atlas.WouldCycle is: a cycle elsewhere in the data must never
	// hang this read.
	var chain []atlasChainEntry
	seen := map[string]bool{}
	for cur := card.ParentID; cur != "" && !seen[cur]; {
		seen[cur] = true
		anc, ok := byID[cur]
		if !ok {
			break
		}
		chain = append([]atlasChainEntry{{ID: anc.ID, Title: anc.Title}}, chain...)
		cur = anc.ParentID
	}
	if chain != nil {
		out.ParentChain = chain
	}

	for _, c := range visibleCards {
		if c.ParentID == cardID {
			out.Children = append(out.Children, atlasChildEntry{ID: c.ID, Title: c.Title, KindID: c.KindID})
		}
	}

	for _, l := range visibleLinks {
		switch cardID {
		case l.FromCardID:
			out.Links = append(out.Links, atlasLinkEntry{
				LinkID: l.ID, Direction: "outgoing", LinkKindID: l.LinkKindID,
				OtherCardID: l.ToCardID, OtherTitle: byID[l.ToCardID].Title, Label: l.Label,
			})
		case l.ToCardID:
			out.Links = append(out.Links, atlasLinkEntry{
				LinkID: l.ID, Direction: "incoming", LinkKindID: l.LinkKindID,
				OtherCardID: l.FromCardID, OtherTitle: byID[l.FromCardID].Title, Label: l.Label,
			})
		}
	}
	return out, nil
}
