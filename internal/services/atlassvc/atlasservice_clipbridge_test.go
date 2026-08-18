package atlassvc

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/servicetest"
)

func TestPreviewClipbridgeReply(t *testing.T) {
	a := NewAtlasService(servicetest.NewFakeStore())

	t.Run("prose is not recognized", func(t *testing.T) {
		p, err := a.PreviewClipbridgeReply("meeting notes, nothing structured")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p.Recognized {
			t.Fatalf("prose recognized: %+v", p)
		}
	})

	t.Run("valid create-cards reply routes and flags collisions", func(t *testing.T) {
		reply := `{"mill":1,"kind":"reply","action":"create-cards","items":[{"title":"Getting started"},{"title":"Brand new"}]}`
		p, err := a.PreviewClipbridgeReply(reply)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !p.Valid || p.RouteWorkflowID == "" || !strings.Contains(p.RouteLabel, "2 cards") {
			t.Fatalf("preview = %+v", p)
		}
		if p.Cards[0].CollidesWithID == "" || p.Cards[1].CollidesWithID != "" {
			t.Fatalf("collision flags wrong: %+v", p.Cards)
		}
	})

	t.Run("invalid reply names its failures", func(t *testing.T) {
		reply := `{"mill":1,"kind":"reply","action":"create-cards","items":[{"note":"missing title"}]}`
		p, err := a.PreviewClipbridgeReply(reply)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p.Valid || len(p.Errors) == 0 {
			t.Fatalf("expected named errors: %+v", p)
		}
	})

	t.Run("note reply routes to the scratchpad workflow", func(t *testing.T) {
		reply := `{"mill":1,"kind":"reply","action":"note-to-scratchpad","items":[{"text":"remember"}]}`
		p, err := a.PreviewClipbridgeReply(reply)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !p.Valid || p.RouteLabel != "Save to Scratchpad" || len(p.NoteTexts) != 1 {
			t.Fatalf("preview = %+v", p)
		}
	})
}

func TestCardContextEnvelope(t *testing.T) {
	a := NewAtlasService(servicetest.NewFakeStore())
	var seedCard atlas.Card
	for _, c := range a.Cards() {
		if c.Title == "Getting started" {
			seedCard = c
		}
	}
	if seedCard.ID == "" {
		t.Fatal("seeded card missing")
	}

	raw, err := a.CardContextEnvelope(seedCard.ID)
	if err != nil {
		t.Fatalf("CardContextEnvelope: %v", err)
	}
	var env map[string]any
	if err := json.Unmarshal([]byte(raw), &env); err != nil {
		t.Fatalf("envelope is not JSON: %v", err)
	}
	if env["mill"] != float64(1) || env["kind"] != "context" {
		t.Fatalf("marker wrong: %v %v", env["mill"], env["kind"])
	}
	items, _ := env["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("items = %v", env["items"])
	}
	first, _ := items[0].(map[string]any)
	if first["title"] != "Getting started" {
		t.Fatalf("item = %v", first)
	}
	if _, ok := env["schema"].(map[string]any); !ok {
		t.Fatal("inline schema missing")
	}

	if _, err := a.CardContextEnvelope("no-such-card"); err == nil {
		t.Fatal("unknown card must error")
	}
}

func TestMaterializeReplyItems(t *testing.T) {
	a := NewAtlasService(servicetest.NewFakeStore())

	t.Run("cards and notes in one batch", func(t *testing.T) {
		summary, err := a.materializeReplyItems(`[{"title":"Batch card","note":"n"},{"text":"batch note"}]`, "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var s struct {
			Cards int      `json:"cards"`
			Notes int      `json:"notes"`
			IDs   []string `json:"ids"`
		}
		if err := json.Unmarshal([]byte(summary), &s); err != nil {
			t.Fatalf("summary not JSON: %v", err)
		}
		if s.Cards != 1 || s.Notes != 1 || len(s.IDs) != 2 {
			t.Fatalf("summary = %+v", s)
		}
	})

	t.Run("summary maps to a declared field or appends to the note", func(t *testing.T) {
		summary, err := a.materializeReplyItems(`[{"title":"With summary","summary":"the gist"}]`, "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		_ = summary
		var made atlas.Card
		for _, c := range a.Cards() {
			if c.Title == "With summary" {
				made = c
			}
		}
		if made.ID == "" {
			t.Fatal("card missing")
		}
		if made.Fields["summary"] == "" && !strings.Contains(made.Note, "the gist") {
			t.Fatalf("summary lost: %+v", made)
		}
	})

	t.Run("unknown kind label errors with its name", func(t *testing.T) {
		_, err := a.materializeReplyItems(`[{"title":"x","kind":"Nonesuch"}]`, "")
		if err == nil || !strings.Contains(err.Error(), "Nonesuch") {
			t.Fatalf("expected a named kind error, got %v", err)
		}
	})

	t.Run("item with neither title nor text errors", func(t *testing.T) {
		_, err := a.materializeReplyItems(`[{"note":"only a note"}]`, "")
		if err == nil {
			t.Fatal("expected an error")
		}
	})
}
