import { useEffect, useState } from 'react'

// The lens' depth toggle (docs/goals/0061: "this level only vs peek
// into children") -- a UI layout preference, not domain data (same
// reasoning app/App.tsx's own sidebarOpen documents for its identical
// localStorage choice over the real settings store), so it's kept
// per-browser-profile rather than round-tripped through
// AtlasService.SetLens/Lens, which persists the per-kind show/hide
// filter only (atlassvc's Lenses map has no depth field). Keyed per
// viewed card ID, same granularity the show/hide lens itself uses.
export type AtlasDepth = 'level' | 'peek'

function storageKey(viewedID: string): string {
  return `mill-atlas-depth-${viewedID || 'root'}`
}

export function useAtlasDepth(viewedID: string): [AtlasDepth, (d: AtlasDepth) => void] {
  const [depth, setDepthState] = useState<AtlasDepth>(
    () => (localStorage.getItem(storageKey(viewedID)) === 'peek' ? 'peek' : 'level'),
  )
  // AtlasView stays mounted across a drill (viewedID changes without a
  // remount), so the lazy initializer above only ever runs once -- this
  // re-reads the per-space value on every viewed-space change instead
  // of carrying the PREVIOUS space's depth forward.
  useEffect(() => {
    setDepthState(localStorage.getItem(storageKey(viewedID)) === 'peek' ? 'peek' : 'level')
  }, [viewedID])
  const setDepth = (d: AtlasDepth) => {
    setDepthState(d)
    localStorage.setItem(storageKey(viewedID), d)
  }
  return [depth, setDepth]
}
