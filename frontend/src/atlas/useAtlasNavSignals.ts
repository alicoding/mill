import { useEffect, useRef, useState } from 'react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { useAppStore } from '../shared/store'
import { useUISignalStore } from '../shared/uiSignalStore'

// AtlasView's own one-shot navigation/dialog-opening signals (goal
// 0071 G17, goal 0072 slice B) -- split out of AtlasView.tsx
// (architecture.md's 500-line convention): atlas.up/atlas.jump each
// bump a shared store counter a palette/keyboard invocation fires,
// consumed here with the same ref-compared-counter shape every other
// Atlas signal in this codebase uses. Every projection view (List,
// and every plugin-contributed pane -- goal 0357, Matrix/Coverage/
// Roadmap all included since goal 0357 S2) SWITCHES the active
// projection pane through its own registry command straight to the
// store, never through this hook.
export function useAtlasNavSignals({ viewedID, allCards, setViewedID, onOpenCard, onBackToBoard }: {
  viewedID: string
  allCards: Card[]
  setViewedID: (id: string) => void
  // api.open(cardId) consumption (goal 0357): the plugin asked and the
  // store signal fired; the same back-to-board-then-overlay walk a
  // projection's own chip click takes.
  onOpenCard: (id: string) => void
  // atlas.board.home consumption (goal 0357): a contributed pane's own
  // Escape, forwarded through the registry.
  onBackToBoard: () => void
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

  // api.open(cardId) (goal 0357): a plugin's own "show me this card"
  // door, consumed here the way a projection chip's click already is --
  // back to the Board, the card page on top. The seq comparison lets a
  // repeat request for the same card fire again.
  const atlasOpenCardRequest = useUISignalStore((s) => s.atlasOpenCardRequest)
  const lastOpenCardSeq = useRef(atlasOpenCardRequest?.seq ?? 0)
  useEffect(() => {
    if (!atlasOpenCardRequest || atlasOpenCardRequest.seq === lastOpenCardSeq.current) return
    lastOpenCardSeq.current = atlasOpenCardRequest.seq
    onOpenCard(atlasOpenCardRequest.id)
  }, [atlasOpenCardRequest, onOpenCard])

  // atlas.board.home (goal 0357): a contributed pane's page catches
  // its own Escape (the sandbox keeps a frame's keydowns inside it)
  // and asks, through the registry command, to swap back to the board
  // -- the same store write the switcher's Board segment runs.
  const atlasBoardRequest = useUISignalStore((s) => s.atlasBoardRequest)
  const lastBoardRequest = useRef(atlasBoardRequest)
  useEffect(() => {
    if (atlasBoardRequest === lastBoardRequest.current) return
    lastBoardRequest.current = atlasBoardRequest
    onBackToBoard()
  }, [atlasBoardRequest, onBackToBoard])

  return { jumpOpen, setJumpOpen }
}
