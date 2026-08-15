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
