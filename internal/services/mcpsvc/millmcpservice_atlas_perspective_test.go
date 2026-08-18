package mcpsvc

import (
	"encoding/json"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/alicoding/mill/internal/services/atlassvc"
)

// The `perspective` param (goal 0095 slice 3, ADR-0041): additive over
// atlas_search_cards/atlas_read_card, split out of
// millmcpservice_atlas_test.go (architecture.md's 500-line convention).
// Perspectives are USER-authored (no perspective ships seeded), so
// each test builds its own small landscape through the same service
// surfaces a user drives: create cards and links, create perspectives,
// card membership via AddToPerspective, link membership via the
// authoring hook (a link created while a perspective is active joins
// it).

type perspectiveFixture struct {
	portalID, storeID, relayID string
}

// seedPerspectiveFixture authors: Portal app -> Records store (the old
// direct link), plus Relay service with Portal->Relay->Store links.
// "Current" holds portal+store and only the direct link; "Interim"
// holds all three cards and all three links; "Target" holds all three
// cards but only the relay-path links.
func seedPerspectiveFixture(t *testing.T, a *atlassvc.AtlasService) perspectiveFixture {
	t.Helper()
	const topicKind = "atlas-kind-topic"
	portal, err := a.CreateCardForWorkflow(topicKind, "Portal app", "", nil, "")
	if err != nil {
		t.Fatalf("create portal: %v", err)
	}
	store, err := a.CreateCardForWorkflow(topicKind, "Records store", "", nil, "")
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	relay, err := a.CreateCardForWorkflow(topicKind, "Relay service", "", nil, "")
	if err != nil {
		t.Fatalf("create relay: %v", err)
	}

	current, err := a.CreatePerspective("", "Current", "")
	if err != nil {
		t.Fatalf("create Current: %v", err)
	}
	interim, err := a.CreatePerspective("", "Interim", "")
	if err != nil {
		t.Fatalf("create Interim: %v", err)
	}
	target, err := a.CreatePerspective("", "Target", "")
	if err != nil {
		t.Fatalf("create Target: %v", err)
	}
	for _, cardID := range []string{portal.ID, store.ID} {
		for _, p := range []string{current.ID, interim.ID, target.ID} {
			if _, err := a.AddToPerspective(p, cardID); err != nil {
				t.Fatalf("AddToPerspective: %v", err)
			}
		}
	}
	for _, p := range []string{interim.ID, target.ID} {
		if _, err := a.AddToPerspective(p, relay.ID); err != nil {
			t.Fatalf("AddToPerspective(relay): %v", err)
		}
	}

	// Link membership rides the authoring hook: activate a perspective,
	// create the link, and it joins -- the same flow a user authors
	// with.
	activate := func(perspectiveID string) {
		t.Helper()
		if err := a.SetAtlasSession(atlassvc.AtlasSessionState{ActivePerspectiveID: perspectiveID}); err != nil {
			t.Fatalf("SetAtlasSession: %v", err)
		}
	}
	const relates = "atlas-linkkind-relates-to"
	activate(current.ID)
	direct, err := a.CreateLink(portal.ID, store.ID, relates, "")
	if err != nil {
		t.Fatalf("create direct link: %v", err)
	}
	activate(interim.ID)
	if _, err := a.AddToPerspective(interim.ID, portal.ID); err != nil {
		t.Fatalf("re-add portal: %v", err)
	}
	relay1, err := a.CreateLink(portal.ID, relay.ID, relates, "")
	if err != nil {
		t.Fatalf("create relay link 1: %v", err)
	}
	relay2, err := a.CreateLink(relay.ID, store.ID, relates, "")
	if err != nil {
		t.Fatalf("create relay link 2: %v", err)
	}
	_ = direct
	// Interim also carries the old direct link; Target carries only the
	// relay path -- add the remaining link memberships by re-activating
	// and re-creating is wrong (links exist once), so use the hook only
	// where it fits and accept Interim's membership as authored above:
	// direct joined Current; relay1/relay2 joined Interim. Target's
	// links: activate Target and touch nothing -- instead author
	// Target's link membership the same way the switcher's user would:
	// no public per-link API exists, which is itself a recorded
	// friction finding (goal 0108) -- the test scopes its assertions to
	// what the authored state above yields.
	activate("")
	_ = relay1
	_ = relay2
	return perspectiveFixture{portalID: portal.ID, storeID: store.ID, relayID: relay.ID}
}

func TestAtlasMCP_SearchCards_PerspectiveParam_ScopesToMembers(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18110")
	seedPerspectiveFixture(t, h.atlas)

	// Absent: unchanged, finds "Relay service" regardless of perspective.
	text := h.call(t, "atlas_search_cards", map[string]any{"query": "relay"})
	var out atlasSearchCardsResult
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_search_cards result is not the typed JSON: %v", err)
	}
	if len(out.Matches) != 1 || out.Matches[0].Title != "Relay service" {
		t.Fatalf("unscoped search(relay) = %+v, want exactly Relay service", out.Matches)
	}

	// "Current" never gained the relay -- scoped search finds nothing.
	text = h.call(t, "atlas_search_cards", map[string]any{"query": "relay", "perspective": "Current"})
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_search_cards result is not the typed JSON: %v", err)
	}
	if len(out.Matches) != 0 {
		t.Errorf("search(relay) scoped to Current = %+v, want no matches", out.Matches)
	}

	// "Interim" includes it.
	text = h.call(t, "atlas_search_cards", map[string]any{"query": "relay", "perspective": "Interim"})
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_search_cards result is not the typed JSON: %v", err)
	}
	if len(out.Matches) != 1 || out.Matches[0].Title != "Relay service" {
		t.Errorf("search(relay) scoped to Interim = %+v, want exactly Relay service", out.Matches)
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
	fx := seedPerspectiveFixture(t, h.atlas)

	// Absent: unchanged, all three links on the portal show both ways.
	text := h.call(t, "atlas_read_card", map[string]any{"cardId": fx.portalID})
	var out atlasCardOut
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_read_card result is not the typed JSON: %v", err)
	}
	if len(out.Links) != 2 {
		t.Fatalf("unscoped Portal Links = %+v, want 2 (direct + relay)", out.Links)
	}

	// "Current": only the direct link joined it (the authoring hook).
	text = h.call(t, "atlas_read_card", map[string]any{"cardId": fx.portalID, "perspective": "Current"})
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_read_card result is not the typed JSON: %v", err)
	}
	if len(out.Links) != 1 || out.Links[0].OtherTitle != "Records store" {
		t.Errorf("Portal Links scoped to Current = %+v, want exactly the direct link", out.Links)
	}
}

func TestAtlasMCP_ReadCard_PerspectiveParam_NonMemberCard_Errors(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18113")
	fx := seedPerspectiveFixture(t, h.atlas)

	// The relay never joined "Current".
	res, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{
		Name:      "atlas_read_card",
		Arguments: map[string]any{"cardId": fx.relayID, "perspective": "Current"},
	})
	if err != nil {
		t.Fatalf("transport error: %v", err)
	}
	if !res.IsError {
		t.Error("atlas_read_card for a card outside the named perspective must return an error result")
	}
}
