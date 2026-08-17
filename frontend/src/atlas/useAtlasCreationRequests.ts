import { useRef, useState } from 'react'
import type { AtlasCreationTool } from './AtlasCreationTray'
import type { AtlasGroupRequest, AtlasPlacementRequest, AtlasPromoteRequest } from './useAtlasCreation'

// AtlasView's own tiny dispatcher for the downward creation requests
// its right-click menus fire (goal 0081 slice A1's "Add card"/"Add
// note"/"Promote to card…" items, extended by slice A2's frame-scoped
// "Add card to X"/"Add note here" and multi-select "Group into new
// area") -- split out (architecture.md's 500-line convention) so
// AtlasView.tsx itself only ever calls the request* functions this
// returns. AtlasBoard.tsx owns the actual popover/marquee state these
// requests drive; this file is purely the token-carrying dispatch.
export function useAtlasCreationRequests() {
  const counter = useRef(0)
  const [placementRequest, setPlacementRequest] = useState<AtlasPlacementRequest | null>(null)
  const [promoteRequest, setPromoteRequest] = useState<AtlasPromoteRequest | null>(null)
  const [groupRequest, setGroupRequest] = useState<AtlasGroupRequest | null>(null)

  const requestPlacement = (tool: AtlasCreationTool, pos: { x: number; y: number }, parentIDOverride?: string) => {
    counter.current += 1
    setPlacementRequest({ tool, pos, parentIDOverride, token: counter.current })
  }
  // "Add linked card…" (goal 0081 slice A4): the card menu's own
  // downward request, carrying the linking card's id instead of a
  // parent override -- useAtlasCreation.placeAt resolves the actual
  // parent/position from it server-relative (freeChildPosition against
  // the source card's own parent).
  const requestLinkedCard = (fromCardID: string, pos: { x: number; y: number }) => {
    counter.current += 1
    setPlacementRequest({ tool: 'card', pos, linkFromCardID: fromCardID, token: counter.current })
  }
  const requestPromote = (noteID: string, pos: { x: number; y: number }) => {
    counter.current += 1
    setPromoteRequest({ noteID, pos, token: counter.current })
  }
  // Select-then-group (LOCKED design §2's "select, then group" door):
  // the SAME area-mode popover the marker-box draws uses, requested
  // from AtlasView's multi-select context menu instead of a drag.
  const requestGroup = (cardIDs: string[], noteIDs: string[], pos: { x: number; y: number }) => {
    counter.current += 1
    setGroupRequest({ cardIDs, noteIDs, pos, token: counter.current })
  }

  return { placementRequest, requestPlacement, requestLinkedCard, promoteRequest, requestPromote, groupRequest, requestGroup }
}
