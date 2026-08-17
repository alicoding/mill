import { useRef, useState } from 'react'
import type { AtlasCreationTool } from './AtlasCreationTray'
import type { AtlasPlacementRequest, AtlasPromoteRequest } from './useAtlasCreation'

// AtlasView's own tiny dispatcher for the two downward creation
// requests the pane right-click menu fires (goal 0081 slice A1's
// "Add card"/"Add note"/"Promote to card…" items) -- split out
// (architecture.md's 500-line convention) so AtlasView.tsx itself only
// ever calls the two request* functions this returns.
export function useAtlasCreationRequests() {
  const counter = useRef(0)
  const [placementRequest, setPlacementRequest] = useState<AtlasPlacementRequest | null>(null)
  const [promoteRequest, setPromoteRequest] = useState<AtlasPromoteRequest | null>(null)

  const requestPlacement = (tool: AtlasCreationTool, pos: { x: number; y: number }) => {
    counter.current += 1
    setPlacementRequest({ tool, pos, token: counter.current })
  }
  const requestPromote = (noteID: string, pos: { x: number; y: number }) => {
    counter.current += 1
    setPromoteRequest({ noteID, pos, token: counter.current })
  }

  return { placementRequest, requestPlacement, promoteRequest, requestPromote }
}
