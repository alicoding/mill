import { useState } from 'react'

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

  return { matrixOpen, setMatrixOpen, coverageOpen, setCoverageOpen, roadmapOpen, setRoadmapOpen, contentsOpen, setContentsOpen, openCardFromProjection }
}
