package atlassvc

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/clipbridge"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/seeding"
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
	Recognized bool `json:"Recognized"`
	Valid      bool `json:"Valid"`
	// Empty marks a schema-valid reply whose action carried zero items
	// -- a deliberate no-op, distinct from both a validation failure
	// and an ordinary proposal (see clipbridge.ReplyPreview.Empty).
	Empty           bool                  `json:"Empty"`
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
		Empty:      p.Empty,
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

// contextCardFrom converts one card's already-resolved
// cardContextInput into the OUT envelope's ContextCard shape -- shared
// by CardContextEnvelope (one card) and SpaceContextEnvelope (every
// child of a space) so the two envelope builders can't drift apart.
func contextCardFrom(in cardContextInput) clipbridge.ContextCard {
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
	return ctxCard
}

// marshalEnvelope is BuildContextEnvelope's own indented-JSON encoding,
// shared by every envelope-returning bound method below.
func marshalEnvelope(env clipbridge.Envelope, err error) (string, error) {
	if err != nil {
		return "", err
	}
	raw, err := json.MarshalIndent(env, "", "  ")
	if err != nil {
		return "", err
	}
	return string(raw), nil
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

	return marshalEnvelope(clipbridge.BuildContextEnvelope([]clipbridge.ContextCard{contextCardFrom(in)}, labels, clipbridge.V1Actions()))
}

// SpaceContextEnvelope renders spaceID's own children as one OUT
// envelope (goal 0101): the companion panel's system context on every
// turn, scoped to whatever the user is currently looking at rather
// than the whole map. Same child-listing loop as SpaceBundleContext's
// plain-text sibling (spaceID == "" names the true root), each child
// converted through the identical per-card path CardContextEnvelope
// uses for a single card.
func (a *AtlasService) SpaceContextEnvelope(spaceID string) (string, error) {
	a.mu.RLock()
	if spaceID != "" && a.findCardLocked(spaceID) == -1 {
		a.mu.RUnlock()
		return "", fmt.Errorf("no card with id %q", spaceID)
	}
	labels := make([]string, 0, len(a.kinds))
	for _, k := range a.kinds {
		labels = append(labels, k.Label)
	}
	var cards []clipbridge.ContextCard
	for _, c := range a.liveCardsLocked() {
		if c.ParentID != spaceID {
			continue
		}
		in, err := a.cardContextInputLocked(c.ID)
		if err != nil {
			a.mu.RUnlock()
			return "", err
		}
		cards = append(cards, contextCardFrom(in))
	}
	a.mu.RUnlock()
	sort.Strings(labels)

	return marshalEnvelope(clipbridge.BuildContextEnvelope(cards, labels, clipbridge.V1Actions()))
}

// replyItemDraft is one accepted reply item's wire shape -- a
// non-empty Title names a card draft, a non-empty Text names a note
// draft; clipbridge.ParseReply's own per-action schema upstream is
// what keeps the two from arriving mixed on one item.
type replyItemDraft struct {
	Title   string `json:"title"`
	Kind    string `json:"kind"`
	Note    string `json:"note"`
	Summary string `json:"summary"`
	Text    string `json:"text"`
}

// createReplyCard resolves item's kind/summary placement and creates
// the card -- split out of materializeReplyItems purely to keep that
// function's own cognitive complexity under the repo's gate. cardIndex
// is this batch's own running count, fed to importGridPosition when
// parentID is set so a multi-card batch lands without overlapping
// itself.
func (a *AtlasService) createReplyCard(item replyItemDraft, kindByLabel map[string]atlas.Kind, defaultKind atlas.Kind, parentID string, cardIndex int, sourceRunID string) (atlas.Card, error) {
	kind := defaultKind
	if item.Kind != "" {
		k, ok := kindByLabel[strings.ToLower(item.Kind)]
		if !ok {
			return atlas.Card{}, fmt.Errorf("no kind labeled %q", item.Kind)
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
	if parentID == "" {
		return a.CreateCardForWorkflow(kind.ID, item.Title, note, fields, sourceRunID)
	}
	return a.createCardWithID(seeding.NewSlugID(item.Title, "card"), kind.ID, item.Title, note, fields,
		parentID, importGridPosition(cardIndex), "", "", "", "", "", sourceRunID)
}

// materializeReplyItems is the apply-atlas-from-reply seam: accepted
// reply items become real records. An item with a title becomes a card
// (kind label resolved against the CURRENT kinds; summary lands in the
// kind's own "summary" field when it declares one, otherwise appended
// to the note so nothing is silently dropped); an item with text
// becomes a Scratchpad note, unaffected by parentID. parentID names the
// space a card item lands inside ("" for the board root, the pre-goal-
// 0101-slice-2 default): a companion Accept threads the space the user
// was actually viewing, placed via the same grid layout bulk import
// already uses (importGridPosition) since a batch of new cards landing
// together is the identical "not collision-checked against pre-
// existing siblings, expected to be dragged into place" shape.
func (a *AtlasService) materializeReplyItems(itemsJSON, parentID, sourceRunID string) (string, error) {
	var items []replyItemDraft
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
			card, err := a.createReplyCard(item, kindByLabel, defaultKind, parentID, cards, sourceRunID)
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

// CorrectionEnvelope re-emits the reply contract for the
// re-ask-the-source loop: validation problems and declined titles ride
// the instruction line, the schema stays the instruction.
func (a *AtlasService) CorrectionEnvelope(problems []string, declinedTitles []string) (string, error) {
	kinds := a.Kinds()
	labels := make([]string, 0, len(kinds))
	for _, k := range kinds {
		labels = append(labels, k.Label)
	}
	sort.Strings(labels)
	env, err := clipbridge.BuildCorrectionEnvelope(problems, declinedTitles, labels, clipbridge.V1Actions())
	if err != nil {
		return "", err
	}
	raw, err := json.MarshalIndent(env, "", "  ")
	if err != nil {
		return "", err
	}
	return string(raw), nil
}
