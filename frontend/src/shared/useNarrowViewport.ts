import { useEffect, useState } from 'react'

// Single source of truth for "narrow viewport," matching Primer's own
// PageLayout/Dialog breakpoint (767px, confirmed against their compiled
// CSS) so app-owned responsive logic never drifts from what Primer's
// own components already switch on internally at the same width.
const NARROW_QUERY = '(max-width: 767px)'

// A leaf hook (shared/, no upward imports) consumed by app/ (mobile nav
// drawer) and atlas/ (canvas read-only fallback) alike -- one listener
// shape instead of each caller re-deriving its own matchMedia wiring.
export function useIsNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches)
  useEffect(() => {
    const mql = window.matchMedia(NARROW_QUERY)
    const onChange = () => setNarrow(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return narrow
}

// The two-pane threshold (goal 0321): at 1024px and up a list surface
// can hold a detail pane BESIDE it; below that the detail replaces the
// list and a back link returns. 1024 is the converged tablet-landscape
// breakpoint the same surfaces switch on elsewhere -- kept here beside
// NARROW_QUERY so the app has one file naming its breakpoints.
const TWO_PANE_QUERY = '(min-width: 1024px)'

export function useHasSidePane(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(TWO_PANE_QUERY).matches)
  useEffect(() => {
    const mql = window.matchMedia(TWO_PANE_QUERY)
    const onChange = () => setWide(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return wide
}
