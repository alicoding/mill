package atlassvc

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/clipbridge"
	"github.com/alicoding/mill/internal/domain/composition"
)

// The clipboard bridge (goal 0099) lives beside AtlasService because
// every dynamic part of the protocol is Atlas's own data: the kind
// labels the reply schema enumerates, the card titles collision
// detection compares against, and the records an accepted reply
// materializes into. The protocol itself stays in domain/clipbridge.

// ClipbridgeCardOffer is one to-be-created card row on the review
// surface: the parsed draft plus its collision flag (the dedupe
// convention -- colliding rows default unchecked).
type ClipbridgeCardOffer struct {
	Draft            clipbridge.CardDraft `json:"Draft"`
	CollidesWithID   string               `json:"CollidesWithID"`
	CollidesWithKind string               `json:"CollidesWithKind"`
}

// ClipbridgeReplyPreview is what the Quick Panel renders when the
// clipboard carries a mill reply: the domain preview plus the
// Atlas-side collision annotations and the route workflow to run on
// accept.
type ClipbridgeReplyPreview struct {
	Recognized      bool                  `json:"Recognized"`
	Valid           bool                  `json:"Valid"`
	Action          string                `json:"Action"`
	Errors          []string              `json:"Errors"`
	Cards           []ClipbridgeCardOffer `json:"Cards"`
	NoteTexts       []string              `json:"NoteTexts"`
	RouteWorkflowID string                `json:"RouteWorkflowID"`
	RouteLabel      string                `json:"RouteLabel"`
}

// PreviewClipbridgeReply validates a raw clipboard string against the
// reply contract (schema-first, then per-action requirements) and
// annotates it with collision state. Malformed input renders inline --
// this returns a Go error only for internal faults.
func (a *AtlasService) PreviewClipbridgeReply(raw string) (ClipbridgeReplyPreview, error) {
	kinds := a.Kinds()
	labels := make([]string, 0, len(kinds))
	for _, k := range kinds {
		labels = append(labels, k.Label)
	}
	sort.Strings(labels)

	p := clipbridge.ParseReply(raw, labels, clipbridge.V1Actions())
	out := ClipbridgeReplyPreview{
		Recognized: p.Recognized,
		Valid:      p.Valid,
		Action:     p.Action,
		Errors:     p.Errors,
		NoteTexts:  p.NoteTexts,
	}
	if !p.Recognized {
		return out, nil
	}
	switch p.Action {
	case clipbridge.ActionCreateCards:
		out.RouteWorkflowID = composition.ReplyCardsWorkflowID
		out.RouteLabel = fmt.Sprintf("Create %d cards", len(p.Cards))
		if len(p.Cards) == 1 {
			out.RouteLabel = "Create 1 card"
		}
	case clipbridge.ActionNoteToScratchpad:
		out.RouteWorkflowID = composition.ReplyNoteWorkflowID
		out.RouteLabel = "Save to Scratchpad"
	}

	byTitle := map[string]atlas.Card{}
	for _, c := range a.Cards() {
		byTitle[strings.ToLower(strings.TrimSpace(c.Title))] = c
	}
	kindLabelByID := map[string]string{}
	for _, k := range kinds {
		kindLabelByID[k.ID] = k.Label
	}
	for _, d := range p.Cards {
		offer := ClipbridgeCardOffer{Draft: d}
		if existing, ok := byTitle[strings.ToLower(strings.TrimSpace(d.Title))]; ok {
			offer.CollidesWithID = existing.ID
			offer.CollidesWithKind = kindLabelByID[existing.KindID]
		}
		out.Cards = append(out.Cards, offer)
	}
	return out, nil
}

// CardContextEnvelope renders a card as the OUT envelope (goal 0099):
// its data as items, the reply contract inline. The plain-text
// CardContextBlock stays for human destinations; this is the
// machine-readable twin an external AI answers against.
func (a *AtlasService) CardContextEnvelope(cardID string) (string, error) {
	a.mu.RLock()
	in, err := a.cardContextInputLocked(cardID)
	if err != nil {
		a.mu.RUnlock()
		return "", err
	}
	labels := make([]string, 0, len(a.kinds))
	for _, k := range a.kinds {
		labels = append(labels, k.Label)
	}
	a.mu.RUnlock()
	sort.Strings(labels)

	ctxCard := clipbridge.ContextCard{Title: in.title, Kind: in.kindLabel, Note: in.note}
	if len(in.fields) > 0 {
		ctxCard.Fields = make(map[string]string, len(in.fields))
		for _, f := range in.fields {
			ctxCard.Fields[f.label] = f.value
		}
	}
	for _, l := range in.outgoing {
		ctxCard.Links = append(ctxCard.Links, clipbridge.ContextLink{Kind: l.linkKindLabel, Direction: "out", Title: l.otherTitle})
	}
	for _, l := range in.incoming {
		ctxCard.Links = append(ctxCard.Links, clipbridge.ContextLink{Kind: l.linkKindLabel, Direction: "in", Title: l.otherTitle})
	}

	env, err := clipbridge.BuildContextEnvelope([]clipbridge.ContextCard{ctxCard}, labels, clipbridge.V1Actions())
	if err != nil {
		return "", err
	}
	raw, err := json.MarshalIndent(env, "", "  ")
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// materializeReplyItems is the apply-atlas-from-reply seam: accepted
// reply items become real records. An item with a title becomes a card
// (kind label resolved against the CURRENT kinds; summary lands in the
// kind's own "summary" field when it declares one, otherwise appended
// to the note so nothing is silently dropped); an item with text
// becomes a Scratchpad note.
func (a *AtlasService) materializeReplyItems(itemsJSON string, sourceRunID string) (string, error) {
	var items []struct {
		Title   string `json:"title"`
		Kind    string `json:"kind"`
		Note    string `json:"note"`
		Summary string `json:"summary"`
		Text    string `json:"text"`
	}
	if err := json.Unmarshal([]byte(itemsJSON), &items); err != nil {
		return "", fmt.Errorf("reply items are not a JSON array: %w", err)
	}

	kinds := a.Kinds()
	if len(kinds) == 0 {
		return "", fmt.Errorf("no card kinds exist to create into")
	}
	kindByLabel := map[string]atlas.Kind{}
	for _, k := range kinds {
		kindByLabel[strings.ToLower(k.Label)] = k
	}
	// A draft without a kind takes the first declared kind -- the
	// schema's enum already restricts named kinds, so this only covers
	// the omitted case.
	defaultKind := kinds[0]

	var ids []string
	cards, notes := 0, 0
	for i, item := range items {
		switch {
		case strings.TrimSpace(item.Title) != "":
			kind := defaultKind
			if item.Kind != "" {
				k, ok := kindByLabel[strings.ToLower(item.Kind)]
				if !ok {
					return "", fmt.Errorf("item %d: no kind labeled %q", i+1, item.Kind)
				}
				kind = k
			}
			note := item.Note
			fields := map[string]string{}
			switch {
			case item.Summary == "":
			case kindDeclaresField(kind, "summary"):
				fields["summary"] = item.Summary
			case note == "":
				note = item.Summary
			default:
				note = note + "\n\n" + item.Summary
			}
			card, err := a.CreateCardForWorkflow(kind.ID, item.Title, note, fields, sourceRunID)
			if err != nil {
				return "", fmt.Errorf("item %d (%q): %w", i+1, item.Title, err)
			}
			ids = append(ids, card.ID)
			cards++
		case strings.TrimSpace(item.Text) != "":
			n, err := a.CreateNote(item.Text, atlas.Position{}, atlas.BuiltInScratchpadCardID)
			if err != nil {
				return "", fmt.Errorf("item %d (note): %w", i+1, err)
			}
			ids = append(ids, n.ID)
			notes++
		default:
			return "", fmt.Errorf("item %d carries neither a title nor text", i+1)
		}
	}

	summary, err := json.Marshal(map[string]any{"cards": cards, "notes": notes, "ids": ids})
	if err != nil {
		return "", err
	}
	return string(summary), nil
}

func kindDeclaresField(k atlas.Kind, key string) bool {
	for _, f := range k.Fields {
		if strings.EqualFold(f.Key, key) {
			return true
		}
	}
	return false
}
