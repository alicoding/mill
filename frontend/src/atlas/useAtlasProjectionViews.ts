import { useState } from 'react'
import type { AtlasBoardView } from './AtlasViewSwitcher'

// The three projection-view open/close booleans -- Matrix, Coverage
// (docs/goals/0064), Roadmap (docs/goals/0212) -- plus their shared "a
// projection's own row/cell click opens a card" door: split out of
// AtlasView.tsx (architecture.md's 500-line convention) since none of
// the three carry state beyond a single boolean -- no card/kind
// selection needs to survive a close/reopen.
export function useAtlasProjectionViews({ onOpenOverlay }: { onOpenOverlay: (id: string) => void }) {
  const [matrixOpen, setMatrixOpen] = useState(false)
  const [coverageOpen, setCoverageOpen] = useState(false)
  const [roadmapOpen, setRoadmapOpen] = useState(false)
  const [contentsOpen, setContentsOpen] = useState(false)

  // Closes whichever projection dialog is open first, so the card
  // overlay never renders stacked behind it.
  const openCardFromProjection = (id: string) => {
    setMatrixOpen(false)
    setCoverageOpen(false)
    setRoadmapOpen(false)
    setContentsOpen(false)
    onOpenOverlay(id)
  }

  // Which of the five ways of looking at this space is on screen (goal
  // 0355): the board itself unless a projection is open over it.
  // DERIVED, never stored, so the view switcher can never disagree with
  // what is actually rendered -- a dialog closed by Escape included.
  const activeView: AtlasBoardView = contentsOpen
    ? 'list'
    : matrixOpen ? 'matrix' : coverageOpen ? 'coverage' : roadmapOpen ? 'roadmap' : 'board'

  const closeAll = () => {
    setContentsOpen(false)
    setMatrixOpen(false)
    setCoverageOpen(false)
    setRoadmapOpen(false)
  }

  return { matrixOpen, setMatrixOpen, coverageOpen, setCoverageOpen, roadmapOpen, setRoadmapOpen, contentsOpen, setContentsOpen, openCardFromProjection, activeView, closeAll }
}
