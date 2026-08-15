// Every Atlas canvas-mode card renders at this fixed footprint --
// mirrors composition/canvasConstants.ts's own "uniform grid of cards,
// not size-to-content boxes" rule, sized wider/shorter than a workflow
// step node since a card's content (kind chip + title + note) reads
// differently than a step's icon+label.
export const ATLAS_CARD_WIDTH = 240
export const ATLAS_CARD_HEIGHT = 96
