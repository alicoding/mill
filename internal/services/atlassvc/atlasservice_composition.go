package atlassvc

import (
	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/composition"
)

// WireCompositionSeams installs the injected-function seams
// apply/process atlas-card-* nodes need (goal 0066) -- mirrors
// ExecutionService.WireChildWorkflowRunner's identical "one call from
// main.go, the wiring itself lives beside the owning service" shape.
// composition can't import atlas/atlassvc directly (atlas already
// imports composition for ExampleChildWorkflowID, so the reverse would
// cycle) -- this file is where the atlas.Card <-> composition.AtlasCard
// conversion actually happens, on this (the service) side of the seam.
//
// cardChangeSink is also installed here (rather than a separate
// main.go call) purely to keep this one call site; SetCardChangeSink
// itself still lives in atlasservice_cardchange.go, the seam's home.
//
//wails:ignore
func (a *AtlasService) WireCompositionSeams(cardChangeSink func(cardID, kindID, title, changeType, sourceRunID string)) {
	composition.SetAtlasCardFinder(a.findCardsForComposition)
	composition.SetAtlasCardCreator(a.createCardForComposition)
	composition.SetAtlasCardUpdater(a.updateCardForComposition)
	composition.SetAtlasCardLinker(a.linkCardsForComposition)
	composition.SetAtlasReplyMaterializer(a.materializeReplyItems)
	composition.SetAtlasDocsSync(a.SyncDocsFolder)
	SetCardChangeSink(cardChangeSink)
}

func (a *AtlasService) findCardsForComposition(kindID string) ([]composition.AtlasCard, error) {
	cards := a.CardsByKind(kindID)
	out := make([]composition.AtlasCard, len(cards))
	for i, c := range cards {
		out[i] = toComposedCard(c)
	}
	return out, nil
}

func (a *AtlasService) createCardForComposition(kindID, title string, fields map[string]string, sourceRunID string) (composition.AtlasCard, error) {
	c, err := a.CreateCardForWorkflow(kindID, title, "", fields, sourceRunID)
	if err != nil {
		return composition.AtlasCard{}, err
	}
	return toComposedCard(c), nil
}

func (a *AtlasService) updateCardForComposition(cardID string, fields map[string]string, sourceRunID string) (composition.AtlasCard, error) {
	c, err := a.MergeCardFields(cardID, fields, sourceRunID)
	if err != nil {
		return composition.AtlasCard{}, err
	}
	return toComposedCard(c), nil
}

func (a *AtlasService) linkCardsForComposition(fromCardID, toCardID, linkKindID, label string) error {
	_, err := a.CreateLink(fromCardID, toCardID, linkKindID, label)
	return err
}

func toComposedCard(c atlas.Card) composition.AtlasCard {
	return composition.AtlasCard{ID: c.ID, KindID: c.KindID, Title: c.Title, Fields: c.Fields}
}
