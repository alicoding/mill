// Every canvas node renders at this fixed width/height regardless of
// label length (CanvasNodeView.tsx) -- a uniform grid of cards, not
// size-to-content boxes. Split out of CanvasNodeView.tsx (a React/CSS
// component file) into their own zero-dependency module so pure-logic
// consumers (canvasLayout.ts's collision math, CompositionCanvas.tsx's
// elkjs layout call) don't drag a component's CSS import chain along
// just to read two numbers -- that coupling broke canvasLayout.ts's own
// unit tests under Vitest (a `.css` import Vitest's transform pipeline
// couldn't handle), which is what surfaced this split.
export const CANVAS_NODE_WIDTH = 220
export const CANVAS_NODE_HEIGHT = 78

// A freshly added note's starting box (CanvasNoteView.tsx) -- resizable
// afterward via NodeResizer, never smaller than this (its own minWidth/
// minHeight props use the same numbers).
export const CANVAS_NOTE_WIDTH = 220
export const CANVAS_NOTE_HEIGHT = 140
