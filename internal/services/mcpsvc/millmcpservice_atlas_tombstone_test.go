package mcpsvc

import (
	"encoding/json"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// TestAtlasMCP_DeletedCard_ExcludedFromEveryReadSurface pins goal
// 0093's MCP exclusion: a soft-deleted card disappears from
// atlas_search_cards, atlas_read_card, and the mill://atlas/cards
// resource -- all three read AtlasService's own exported accessors, so
// this proves the funnel, not three separate filters. Split out of
// millmcpservice_atlas_test.go (architecture.md's 500-line convention),
// reusing that file's own atlasMCPHarness.
func TestAtlasMCP_DeletedCard_ExcludedFromEveryReadSurface(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18106")
	target := h.cardByTitle(t, "Jordan Reyes")
	if _, err := h.atlas.DeleteCard(target.ID); err != nil {
		t.Fatalf("DeleteCard: %v", err)
	}

	searchText := h.call(t, "atlas_search_cards", map[string]any{"query": "Jordan Reyes"})
	var searchOut atlasSearchCardsResult
	if err := json.Unmarshal([]byte(searchText), &searchOut); err != nil {
		t.Fatalf("atlas_search_cards result is not the typed JSON: %v", err)
	}
	for _, m := range searchOut.Matches {
		if m.ID == target.ID {
			t.Error("atlas_search_cards returned a soft-deleted card")
		}
	}

	res, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{Name: "atlas_read_card", Arguments: map[string]any{"cardId": target.ID}})
	if err != nil {
		t.Fatalf("transport error: %v", err)
	}
	if !res.IsError {
		t.Error("atlas_read_card on a soft-deleted card must return an error result")
	}

	indexRes, err := h.session.ReadResource(h.ctx, &mcp.ReadResourceParams{URI: "mill://atlas/cards"})
	if err != nil {
		t.Fatalf("ReadResource(mill://atlas/cards): %v", err)
	}
	var entries []atlasCardIndexEntry
	if err := json.Unmarshal([]byte(indexRes.Contents[0].Text), &entries); err != nil {
		t.Fatalf("mill://atlas/cards is not valid JSON: %v", err)
	}
	for _, e := range entries {
		if e.ID == target.ID {
			t.Error("mill://atlas/cards listed a soft-deleted card")
		}
	}
}
