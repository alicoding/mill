import { useEffect, useRef } from 'react'
import { useAppStore } from '../shared/store'
import type { AtlasBoardView } from '../shared/viewKinds'

// Which of the five ways of looking at the viewed space is on screen
// (goal 0355 S2), derived from the persisted atlas View -- never local
// dialog booleans, so the switcher highlight can never disagree with
// what is rendered, a reload lands back on the same pane, and a pane
// closed by Escape is just this value returning to 'board'.
//
// A single stored value IS the mutual exclusion S1's four booleans had
// to hand-roll: two projections can never show at once because the
// field cannot hold two.
export function useAtlasProjectionViews({ onOpenOverlay }: { onOpenOverlay: (id: string) => void }) {
  const activeView: AtlasBoardView = useAppStore((s) => (s.view.kind === 'atlas' ? (s.view.boardView ?? 'board') : 'board'))
  const setAtlasBoardView = useAppStore((s) => s.setAtlasBoardView)
  const setViewRef = useRef(setAtlasBoardView)
  useEffect(() => {
    setViewRef.current = setAtlasBoardView
  }, [setAtlasBoardView])

  // A projection's own row/chip/cell click opens a card (goal 0064's
  // projection door, goal 0279's contents row): back to the Board
  // first -- the card page's canvas affordances ("show on board",
  // focus pulses, the empty-canvas case) only exist there -- then the
  // overlay on top of it.
  const openCardFromProjection = (id: string) => {
    setViewRef.current('board')
    onOpenOverlay(id)
  }

  return {
    activeView,
    setView: setAtlasBoardView,
    // Referenced through a ref so effect-based signal consumers
    // (useAtlasNavSignals) can list it as a dependency without the
    // store identity change re-firing them.
    backToBoard: () => setViewRef.current('board'),
    openCardFromProjection,
  }
}
