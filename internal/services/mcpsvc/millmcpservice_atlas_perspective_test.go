package mcpsvc

import (
	"encoding/json"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The `perspective` param (goal 0095 slice 3, ADR-0041): additive over
// atlas_search_cards/atlas_read_card, split out of
// millmcpservice_atlas_test.go (architecture.md's 500-line convention)
// -- runs against the seeded "Current"/"Interim"/"Target" reference-
// architecture example (internal/domain/atlas/builtin.go's
// BuiltInPerspectives).

func TestAtlasMCP_SearchCards_PerspectiveParam_ScopesToMembers(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18110")

	// Absent: unchanged, finds "Sync service" regardless of perspective.
	text := h.call(t, "atlas_search_cards", map[string]any{"query": "service"})
	var out atlasSearchCardsResult
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_search_cards result is not the typed JSON: %v", err)
	}
	if len(out.Matches) != 1 || out.Matches[0].Title != "Sync service" {
		t.Fatalf("unscoped search(service) = %+v, want exactly Sync service", out.Matches)
	}

	// "Current" never gained the sync service -- scoped search finds nothing.
	text = h.call(t, "atlas_search_cards", map[string]any{"query": "service", "perspective": "Current"})
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_search_cards result is not the typed JSON: %v", err)
	}
	if len(out.Matches) != 0 {
		t.Errorf("search(service) scoped to Current = %+v, want no matches", out.Matches)
	}

	// "Interim" added the sync service alongside the old connection.
	text = h.call(t, "atlas_search_cards", map[string]any{"query": "service", "perspective": "Interim"})
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_search_cards result is not the typed JSON: %v", err)
	}
	if len(out.Matches) != 1 || out.Matches[0].Title != "Sync service" {
		t.Errorf("search(service) scoped to Interim = %+v, want exactly Sync service", out.Matches)
	}
}

func TestAtlasMCP_SearchCards_PerspectiveParam_UnknownPerspective_Errors(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18111")
	res, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{
		Name:      "atlas_search_cards",
		Arguments: map[string]any{"query": "a", "perspective": "does-not-exist"},
	})
	if err != nil {
		t.Fatalf("transport error: %v", err)
	}
	if !res.IsError {
		t.Error("atlas_search_cards with an unknown perspective must return an error result")
	}
}

func TestAtlasMCP_ReadCard_PerspectiveParam_ScopesLinks(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18112")
	webApp := h.cardByTitle(t, "Web app")

	// Absent: unchanged, both the old direct link and the new shape show.
	text := h.call(t, "atlas_read_card", map[string]any{"cardId": webApp.ID})
	var out atlasCardOut
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_read_card result is not the typed JSON: %v", err)
	}
	if len(out.Links) != 2 {
		t.Fatalf("unscoped Web app Links = %+v, want 2 (data store direct + sync service)", out.Links)
	}

	// "Current": only the old direct link to the data store.
	text = h.call(t, "atlas_read_card", map[string]any{"cardId": webApp.ID, "perspective": "Current"})
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_read_card result is not the typed JSON: %v", err)
	}
	if len(out.Links) != 1 || out.Links[0].OtherTitle != "Data store" {
		t.Errorf("Web app Links scoped to Current = %+v, want exactly the link to Data store", out.Links)
	}

	// "Target": the old direct link is gone, only the new shape remains.
	text = h.call(t, "atlas_read_card", map[string]any{"cardId": webApp.ID, "perspective": "Target"})
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_read_card result is not the typed JSON: %v", err)
	}
	if len(out.Links) != 1 || out.Links[0].OtherTitle != "Sync service" {
		t.Errorf("Web app Links scoped to Target = %+v, want exactly the link to Sync service", out.Links)
	}
}

func TestAtlasMCP_ReadCard_PerspectiveParam_NonMemberCard_Errors(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18113")
	syncService := h.cardByTitle(t, "Sync service")

	// Sync service never joined "Current".
	res, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{
		Name:      "atlas_read_card",
		Arguments: map[string]any{"cardId": syncService.ID, "perspective": "Current"},
	})
	if err != nil {
		t.Fatalf("transport error: %v", err)
	}
	if !res.IsError {
		t.Error("atlas_read_card for a card outside the named perspective must return an error result")
	}
}
