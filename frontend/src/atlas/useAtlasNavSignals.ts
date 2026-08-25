import { useEffect, useRef, useState } from 'react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { useAppStore } from '../shared/store'
import { useUISignalStore } from '../shared/uiSignalStore'

// AtlasView's own one-shot navigation/dialog-opening signals (goal
// 0071 G17, goal 0072 slice B) -- split out of AtlasView.tsx
// (architecture.md's 500-line convention): atlas.up/atlas.jump/
// atlas.matrix/atlas.coverage/atlas.roadmap each bump a shared store
// counter a palette/keyboard invocation fires, consumed here with the
// same ref-compared-counter shape every other Atlas signal in this
// codebase uses.
export function useAtlasNavSignals({ viewedID, allCards, setViewedID, setMatrixOpen, setCoverageOpen, setRoadmapOpen }: {
  viewedID: string
  allCards: Card[]
  setViewedID: (id: string) => void
  setMatrixOpen: (open: boolean) => void
  setCoverageOpen: (open: boolean) => void
  setRoadmapOpen: (open: boolean) => void
}) {
  // atlas.up (⌘↑): one step up the depth ladder. Reaching the meta
  // "All spaces" level (parent === '') is always permitted, even with
  // a single root card -- that level is how a lone space becomes
  // actionable as an object again (docs/goals/0183): refusing this
  // made the sole space unreachable except by first creating a
  // throwaway sibling.
  const atlasUpRequest = useAppStore((s) => s.atlasUpRequest)
  const lastUpRequest = useRef(atlasUpRequest)
  useEffect(() => {
    if (atlasUpRequest === lastUpRequest.current) return
    lastUpRequest.current = atlasUpRequest
    if (!viewedID) return
    const parent = allCards.find((c) => c.ID === viewedID)?.ParentID ?? ''
    setViewedID(parent)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the signal tick alone; viewedID/allCards are read at fire time
  }, [atlasUpRequest])

  // atlas.jump (⌘K): opens AtlasJumpDialog, purely controlled off this signal.
  const atlasJumpRequest = useUISignalStore((s) => s.atlasJumpRequest)
  const [jumpOpen, setJumpOpen] = useState(false)
  const lastJumpRequest = useRef(atlasJumpRequest)
  useEffect(() => {
    if (atlasJumpRequest === lastJumpRequest.current) return
    lastJumpRequest.current = atlasJumpRequest
    setJumpOpen(true)
  }, [atlasJumpRequest])

  // atlas.matrix / atlas.coverage: same signal shape, opening the two
  // projection dialogs AtlasView itself owns.
  const atlasMatrixRequest = useUISignalStore((s) => s.atlasMatrixRequest)
  const lastMatrixRequest = useRef(atlasMatrixRequest)
  useEffect(() => {
    if (atlasMatrixRequest === lastMatrixRequest.current) return
    lastMatrixRequest.current = atlasMatrixRequest
    setMatrixOpen(true)
  }, [atlasMatrixRequest])

  const atlasCoverageRequest = useUISignalStore((s) => s.atlasCoverageRequest)
  const lastCoverageRequest = useRef(atlasCoverageRequest)
  useEffect(() => {
    if (atlasCoverageRequest === lastCoverageRequest.current) return
    lastCoverageRequest.current = atlasCoverageRequest
    setCoverageOpen(true)
  }, [atlasCoverageRequest])

  const atlasRoadmapRequest = useUISignalStore((s) => s.atlasRoadmapRequest)
  const lastRoadmapRequest = useRef(atlasRoadmapRequest)
  useEffect(() => {
    if (atlasRoadmapRequest === lastRoadmapRequest.current) return
    lastRoadmapRequest.current = atlasRoadmapRequest
    setRoadmapOpen(true)
  }, [atlasRoadmapRequest])

  return { jumpOpen, setJumpOpen }
}
