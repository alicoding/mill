import { useMemo } from 'react'
import { enclosureQuery } from './atlasEnclosure'
import type { AtlasGestureCtx } from './atlasNounRegistry'

// useAtlasGestureCtx assembles the gesture ctx AtlasBoard threads
// through the engine (atlasNounRegistry.ts's AtlasGestureCtx): the
// board's boxes, the spatial door over them (goal 0310), and the
// creation/selection callbacks. hitAccumulator here is a placeholder
// the engine replaces per gesture (useAtlasToolGesture.ts's buildCtx).
type Input = Omit<AtlasGestureCtx, 'enclosedIn' | 'hitAccumulator'>

export function useAtlasGestureCtx(input: Input): AtlasGestureCtx {
  const { screenToFlowPosition, parentID, cardBoxes, noteBoxes, objectBoxes, onDeleteSelection, openAreaPopover, onShapeCreated, disarm, disarmUnlessLocked } = input
  return useMemo(() => ({
    screenToFlowPosition, parentID, cardBoxes, noteBoxes, objectBoxes,
    enclosedIn: enclosureQuery(cardBoxes, noteBoxes, objectBoxes),
    onDeleteSelection, openAreaPopover, onShapeCreated, disarm, disarmUnlessLocked,
    hitAccumulator: { cardIDs: new Set<string>(), noteIDs: new Set<string>(), objectIDs: new Set<string>() },
  }), [screenToFlowPosition, parentID, cardBoxes, noteBoxes, objectBoxes, onDeleteSelection, openAreaPopover, onShapeCreated, disarm, disarmUnlessLocked])
}
