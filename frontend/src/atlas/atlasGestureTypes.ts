import type { ComponentType } from 'react'
import type { FrameBox } from './useAtlasDragFiling'

// The gesture-engine type vocabulary (goal 0215 S2), split from
// atlasNounRegistry.ts along the pure-types seam (500-line
// convention): every field's contract is documented where it was
// authored; this module only carries the shapes.
// AtlasGesturePoint -- one accumulated point of an in-flight gesture,
// always carrying its own capture timestamp so an ephemeral tool
// (laser's fadeMs) can age individual points out independently; every
// other tool simply ignores `t`.
export interface AtlasGesturePoint { x: number; y: number; t: number }

// AtlasGestureCtx -- what a tool's own gesture.onPoint/onEnd may reach,
// assembled fresh each render by AtlasBoard.tsx and threaded through by
// the engine. Deliberately NOT the wrapper box or React Flow's own
// screenToFlowPosition internals beyond the function itself -- kept to
// exactly what the five hooks this contract replaces actually consumed
// (goal 0215 S2 design lock item 1).
export interface AtlasGestureCtx {
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  parentID: string
  cardBoxes: FrameBox[]
  noteBoxes: { id: string; x: number; y: number; width: number; height: number }[]
  // Every board-local object's (ink/shape/image/table/diagram) own
  // rendered flow-space box -- read off React Flow's own measured node
  // state (goal 0230), since a BoardObject's persisted Size stays null
  // until first resize and its rendered footprint is otherwise CSS-
  // intrinsic (atlasBuildBoardObjectNodes.ts's own header comment).
  objectBoxes: { id: string; x: number; y: number; width: number; height: number }[]
  onDeleteSelection: (cardIDs: string[], noteIDs: string[], objectIDs: string[]) => void
  openAreaPopover: (screenPos: { x: number; y: number }, flowPos: { x: number; y: number }, enclosedCardIDs: string[], enclosedNoteIDs: string[]) => void
  onShapeCreated: (objectID: string) => void
  // Real functions for a one-shot tool; no-ops for a sticky one (the
  // engine's own gestureDisarmFns enforces this, not each tool).
  disarm: () => void
  disarmUnlessLocked: () => void
  // Fresh per-gesture scratch space the engine allocates at pointerdown
  // and discards after onEnd -- eraser's own onPoint is the sole
  // consumer today; no other tool touches it.
  hitAccumulator: { cardIDs: Set<string>; noteIDs: Set<string>; objectIDs: Set<string> }
}

// AtlasToolGesture -- a drag-shaped tool's own pure behavior
// contribution. onEnd receives the FULL client-space point list
// unconditionally (even a below-threshold stray click) -- deciding
// whether that constitutes a real gesture (a distance threshold, a
// hit count, or nothing at all) is each tool's own call, matching how
// the five hooks this contract replaces each guarded their own commit
// differently (eraser's own guard is "did we hit anything", never a
// distance).
export interface AtlasToolGesture {
  onPoint?: (pt: AtlasGesturePoint, ctx: AtlasGestureCtx) => void
  onEnd: (points: AtlasGesturePoint[], ctx: AtlasGestureCtx) => void
  // Rendered generically by AtlasBoard.tsx in ONE overlay slot, wrapper-
  // spanning, fed the engine's own wrapper-local point accumulation.
  preview?: ComponentType<{ points: AtlasGesturePoint[]; now: number }>
  // Ephemeral tools (laser) never commit -- their accumulated points
  // fade out on their own timer instead of clearing at pointerup, the
  // one generic mechanism useAtlasToolGesture.ts owns for an
  // 'ephemeral-drag' tool so no tool needs its own rAF loop.
  fadeMs?: number
}

