package mcpsvc

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Atlas over MCP (goal 0083): real MCP client over real loopback HTTP,
// the same harness shape TestMillMCPService_RealClientRoundTrip and
// millmcpservice_approval_test.go's mcpApprovalHarness already
// establish for this package -- no literal in-memory duplex transport
// exists in this codebase (checked: no InMemoryTransport usage
// anywhere under internal/services/mcpsvc), so this follows the SAME
// in-process-loopback-HTTP precedent rather than inventing a second
// harness shape.

type atlasMCPHarness struct {
	svc     *MillMCPService
	atlas   *atlassvc.AtlasService
	session *mcp.ClientSession
	ctx     context.Context
}

func newAtlasMCPHarness(t *testing.T, addr string) *atlasMCPHarness {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	atlasSvc := atlassvc.NewAtlasService(store)

	svc := NewMillMCPService("0.0.0-test", comp, cfg, store)
	svc.SetAtlasService(atlasSvc)
	if err := svc.Start(addr); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = svc.Shutdown(ctx)
	})

	client := mcp.NewClient(&mcp.Implementation{Name: "mill-atlas-mcp-test", Version: "0.0.0"}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: "http://" + addr}, nil)
	if err != nil {
		t.Fatalf("client.Connect: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })

	return &atlasMCPHarness{svc: svc, atlas: atlasSvc, session: session, ctx: ctx}
}

func (h *atlasMCPHarness) call(t *testing.T, name string, args map[string]any) string {
	t.Helper()
	res, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("%s: transport error: %v", name, err)
	}
	if res.IsError {
		t.Fatalf("%s: tool error: %+v", name, res.Content)
	}
	return res.Content[0].(*mcp.TextContent).Text
}

func (h *atlasMCPHarness) cardByTitle(t *testing.T, title string) atlas.Card {
	t.Helper()
	for _, c := range h.atlas.Cards() {
		if c.Title == title {
			return c
		}
	}
	t.Fatalf("no seeded card titled %q", title)
	return atlas.Card{}
}

func (h *atlasMCPHarness) kindIDByLabel(t *testing.T, label string) string {
	t.Helper()
	for _, k := range h.atlas.Kinds() {
		if k.Label == label {
			return k.ID
		}
	}
	t.Fatalf("no seeded kind labeled %q", label)
	return ""
}

func (h *atlasMCPHarness) linkKindIDByLabel(t *testing.T, label string) string {
	t.Helper()
	for _, lk := range h.atlas.LinkKinds() {
		if lk.Label == label {
			return lk.ID
		}
	}
	t.Fatalf("no seeded link kind labeled %q", label)
	return ""
}

// --- read tools, against the seeded example space (builtin.go: "My
// space" > "Example area" > "Ada Lovelace"/"Project charter", "Getting
// started" -> Ada "relates to", Ada -> "Project charter" "relates to") ---

func TestAtlasMCP_ListKinds_IncludesSeededTopicWithDeclaredFields(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18095")
	text := h.call(t, "atlas_list_kinds", nil)
	var out atlasListKindsResult
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_list_kinds result is not the typed JSON: %v", err)
	}
	var topic *atlasKindOut
	for i := range out.Kinds {
		if out.Kinds[i].Name == "Topic" {
			topic = &out.Kinds[i]
		}
	}
	if topic == nil {
		t.Fatalf("seeded Topic kind not found in atlas_list_kinds: %+v", out.Kinds)
		return // staticcheck SA5011: t.Fatalf's noreturn fact is lost under CI's build config
	}
	fieldKeys := map[string]bool{}
	for _, f := range topic.Fields {
		fieldKeys[f.Key] = true
	}
	if !fieldKeys["summary"] || !fieldKeys["status"] {
		t.Errorf("Topic kind fields = %+v, want summary and status declared", topic.Fields)
	}
	var sawRelatesTo bool
	for _, lk := range out.LinkKinds {
		if lk.Name == "relates to" {
			sawRelatesTo = true
		}
	}
	if !sawRelatesTo {
		t.Errorf("seeded 'relates to' link kind not found: %+v", out.LinkKinds)
	}
}

func TestAtlasMCP_AtlasCardsResource_ListsSeededCards(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18096")
	res, err := h.session.ReadResource(h.ctx, &mcp.ReadResourceParams{URI: "mill://atlas/cards"})
	if err != nil {
		t.Fatalf("ReadResource(mill://atlas/cards): %v", err)
	}
	var entries []atlasCardIndexEntry
	if err := json.Unmarshal([]byte(res.Contents[0].Text), &entries); err != nil {
		t.Fatalf("mill://atlas/cards is not valid JSON: %v", err)
	}
	titles := map[string]bool{}
	for _, e := range entries {
		titles[e.Title] = true
	}
	for _, want := range []string{"My space", "Example area", "Ada Lovelace", "Project charter"} {
		if !titles[want] {
			t.Errorf("mill://atlas/cards missing seeded card %q: %+v", want, entries)
		}
	}
}

func TestAtlasMCP_SearchCards_MatchesTitleAndReportsParent(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18097")
	exampleArea := h.cardByTitle(t, "Example area")

	// "Ada" matches BOTH the Contact card's own title (Ada Lovelace) and
	// the Document card's "owner" field value ("Ada Lovelace") -- proves
	// the title match specifically, not just that field-value matching
	// works (TestAtlasMCP_SearchCards_MatchesFieldValueNotJustTitleOrNote
	// covers that half).
	text := h.call(t, "atlas_search_cards", map[string]any{"query": "Ada"})
	var out atlasSearchCardsResult
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_search_cards result is not the typed JSON: %v", err)
	}
	var titleMatch *atlasSearchMatch
	for i := range out.Matches {
		if out.Matches[i].Title == "Ada Lovelace" {
			titleMatch = &out.Matches[i]
		}
	}
	if titleMatch == nil {
		t.Fatalf("atlas_search_cards(Ada) = %+v, want a match on Ada Lovelace's own title", out.Matches)
		return // staticcheck SA5011: t.Fatalf's noreturn fact is lost under CI's build config
	}
	if titleMatch.ParentID != exampleArea.ID {
		t.Errorf("match.ParentID = %q, want %q", titleMatch.ParentID, exampleArea.ID)
	}
}

func TestAtlasMCP_SearchCards_MatchesFieldValueNotJustTitleOrNote(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18098")
	// "ada@example.com" only appears in the seeded Contact card's own
	// "email" field, never in its title or note -- proves the matcher
	// covers field values too (goal 0083's "title+note+summary+fields"
	// contract), not just the two columns the frontend's own jump filter
	// (atlasJumpFilter.ts) checks.
	text := h.call(t, "atlas_search_cards", map[string]any{"query": "ada@example.com"})
	var out atlasSearchCardsResult
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_search_cards result is not the typed JSON: %v", err)
	}
	if len(out.Matches) != 1 || out.Matches[0].Title != "Ada Lovelace" {
		t.Fatalf("field-value search = %+v, want exactly one match (Ada Lovelace)", out.Matches)
	}
}

func TestAtlasMCP_ReadCard_ParentChainChildrenAndLinksRoundTrip(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18099")
	mySpace := h.cardByTitle(t, "My space")
	exampleArea := h.cardByTitle(t, "Example area")
	ada := h.cardByTitle(t, "Ada Lovelace")

	text := h.call(t, "atlas_read_card", map[string]any{"cardId": ada.ID})
	var out atlasCardOut
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_read_card result is not the typed JSON: %v", err)
	}

	if out.Title != "Ada Lovelace" || out.Fields["email"] != "ada@example.com" || out.Fields["role"] != "Point of contact" {
		t.Errorf("card content = %+v, want the seeded Ada Lovelace fields", out)
	}

	// Root-ward: root ("My space") first, immediate parent ("Example
	// area") last.
	if len(out.ParentChain) != 2 || out.ParentChain[0].ID != mySpace.ID || out.ParentChain[1].ID != exampleArea.ID {
		t.Errorf("ParentChain = %+v, want [My space, Example area] root-ward", out.ParentChain)
	}

	if len(out.Children) != 0 {
		t.Errorf("Ada Lovelace's Children = %+v, want none", out.Children)
	}

	var sawIncomingFromGetting, sawOutgoingToDocument bool
	for _, l := range out.Links {
		switch {
		case l.Direction == "incoming" && l.OtherTitle == "Getting started":
			sawIncomingFromGetting = true
		case l.Direction == "outgoing" && l.OtherTitle == "Project charter":
			sawOutgoingToDocument = true
		}
	}
	if !sawIncomingFromGetting || !sawOutgoingToDocument {
		t.Errorf("Links = %+v, want an incoming link from 'Getting started' and an outgoing link to 'Project charter'", out.Links)
	}
}

func TestAtlasMCP_ReadCard_UnknownID_Errors(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18100")
	res, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{Name: "atlas_read_card", Arguments: map[string]any{"cardId": "does-not-exist"}})
	if err != nil {
		t.Fatalf("transport error: %v", err)
	}
	if !res.IsError {
		t.Error("atlas_read_card on an unknown id must return an error result")
	}
}

// --- the guarded write: atlas_propose_card_write parks through the
// SAME ADR-0032 queue import_workflow/update_workflow already use ---

func (h *atlasMCPHarness) enableWrites(t *testing.T) {
	t.Helper()
	if err := h.svc.store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatalf("enable MCP writes: %v", err)
	}
	// Approval key left unset: required is the default.
}

func (h *atlasMCPHarness) awaitPending(t *testing.T) MCPWriteRequest {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if pending := h.svc.PendingMCPWrites(); len(pending) == 1 {
			return pending[0]
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("atlas_propose_card_write never parked as a pending MCP write")
	return MCPWriteRequest{}
}

func TestAtlasMCP_ProposeCardWrite_ApproveCreatesCardWithFieldsAndLinks(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18101")
	h.enableWrites(t)

	topicKindID := h.kindIDByLabel(t, "Topic")
	relatesToID := h.linkKindIDByLabel(t, "relates to")
	exampleArea := h.cardByTitle(t, "Example area")
	ada := h.cardByTitle(t, "Ada Lovelace")
	before := len(h.atlas.Cards())

	done := make(chan struct {
		res *mcp.CallToolResult
		err error
	}, 1)
	go func() {
		res, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{
			Name: "atlas_propose_card_write",
			Arguments: map[string]any{
				"kindId":   topicKindID,
				"title":    "MCP-created card",
				"note":     "written by an agent",
				"summary":  "a card created over MCP",
				"status":   "In progress",
				"parentId": exampleArea.ID,
				"links":    []map[string]any{{"toCardId": ada.ID, "linkKindId": relatesToID}},
			},
		})
		done <- struct {
			res *mcp.CallToolResult
			err error
		}{res, err}
	}()

	pending := h.awaitPending(t)
	if pending.Description != `An MCP client wants to CREATE card "MCP-created card" (Topic)` {
		t.Errorf("pending description = %q, want the natural create phrasing", pending.Description)
	}
	if err := h.svc.ResolveMCPWrite(pending.ID, true); err != nil {
		t.Fatalf("ResolveMCPWrite(approve): %v", err)
	}
	out := <-done
	if out.err != nil || out.res.IsError {
		t.Fatalf("approved atlas_propose_card_write failed: err=%v res=%+v", out.err, out.res)
	}

	if got := len(h.atlas.Cards()); got != before+1 {
		t.Fatalf("card count = %d, want %d", got, before+1)
	}
	created := h.cardByTitle(t, "MCP-created card")
	if created.Note != "written by an agent" || created.ParentID != exampleArea.ID {
		t.Errorf("created card = %+v, unexpected note/parent", created)
	}
	if created.Fields["summary"] != "a card created over MCP" || created.Fields["status"] != "In progress" {
		t.Errorf("created card fields = %+v, want summary/status folded in", created.Fields)
	}
	var sawLink bool
	for _, l := range h.atlas.Links() {
		if l.FromCardID == created.ID && l.ToCardID == ada.ID && l.LinkKindID == relatesToID {
			sawLink = true
		}
	}
	if !sawLink {
		t.Errorf("no link from %q to Ada Lovelace was created", created.ID)
	}

	// atlas_get_write_status is this family's own typed poll tool --
	// unmarshals the executor's own JSON result back into a typed cardId
	// rather than leaving that decode to the caller.
	statusText := h.call(t, "atlas_get_write_status", map[string]any{"approvalId": pending.ID})
	var status atlasWriteStatusResult
	if err := json.Unmarshal([]byte(statusText), &status); err != nil {
		t.Fatalf("atlas_get_write_status result is not the typed JSON: %v", err)
	}
	if status.Status != string(MCPWriteStatusApproved) || status.CardID != created.ID {
		t.Errorf("atlas_get_write_status = %+v, want approved with cardId %q", status, created.ID)
	}
}

func TestAtlasMCP_ProposeCardWrite_DenyWritesNothing(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18102")
	h.enableWrites(t)
	topicKindID := h.kindIDByLabel(t, "Topic")
	before := len(h.atlas.Cards())

	done := make(chan struct {
		res *mcp.CallToolResult
		err error
	}, 1)
	go func() {
		res, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{
			Name:      "atlas_propose_card_write",
			Arguments: map[string]any{"kindId": topicKindID, "title": "Should never exist"},
		})
		done <- struct {
			res *mcp.CallToolResult
			err error
		}{res, err}
	}()

	pending := h.awaitPending(t)
	if err := h.svc.ResolveMCPWrite(pending.ID, false); err != nil {
		t.Fatalf("ResolveMCPWrite(deny): %v", err)
	}
	out := <-done
	if out.err != nil {
		t.Fatalf("transport error: %v", out.err)
	}
	if !out.res.IsError {
		t.Fatal("a denied atlas_propose_card_write must return an error result")
	}
	if got := len(h.atlas.Cards()); got != before {
		t.Fatalf("card count = %d, want unchanged %d after deny", got, before)
	}

	statusText := h.call(t, "atlas_get_write_status", map[string]any{"approvalId": pending.ID})
	var status atlasWriteStatusResult
	if err := json.Unmarshal([]byte(statusText), &status); err != nil {
		t.Fatalf("atlas_get_write_status result is not the typed JSON: %v", err)
	}
	if status.Status != string(MCPWriteStatusDenied) || status.CardID != "" {
		t.Errorf("atlas_get_write_status after deny = %+v, want denied with no cardId", status)
	}
}

func TestAtlasMCP_ProposeCardWrite_UpdateMergesOntoExistingCard(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18103")
	h.enableWrites(t)
	getting := h.cardByTitle(t, "Getting started")

	done := make(chan struct {
		res *mcp.CallToolResult
		err error
	}, 1)
	go func() {
		res, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{
			Name: "atlas_propose_card_write",
			Arguments: map[string]any{
				"cardId": getting.ID,
				"status": "Done",
			},
		})
		done <- struct {
			res *mcp.CallToolResult
			err error
		}{res, err}
	}()

	pending := h.awaitPending(t)
	if pending.Description != `An MCP client wants to UPDATE card "Getting started": status` {
		t.Errorf("pending description = %q, want the natural update phrasing", pending.Description)
	}
	if err := h.svc.ResolveMCPWrite(pending.ID, true); err != nil {
		t.Fatalf("ResolveMCPWrite(approve): %v", err)
	}
	out := <-done
	if out.err != nil || out.res.IsError {
		t.Fatalf("approved update failed: err=%v res=%+v", out.err, out.res)
	}

	updated := h.cardByTitle(t, "Getting started")
	if updated.Fields["status"] != "Done" {
		t.Errorf("updated status field = %q, want Done", updated.Fields["status"])
	}
	if updated.Title != "Getting started" || updated.Note != "Declare a Kind, drop a card, link it to something." {
		t.Errorf("update must leave title/note unchanged when not named: %+v", updated)
	}
	if updated.Fields["summary"] != "How this space is organized." {
		t.Errorf("update must MERGE fields, not replace: %+v", updated.Fields)
	}
}
