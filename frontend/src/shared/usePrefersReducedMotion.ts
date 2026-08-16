import { useEffect, useState } from 'react'

// Single source of truth for the OS-level reduced-motion preference,
// mirroring useIsNarrowViewport.ts's own matchMedia-listener shape --
// the JS-side counterpart to the `@media (prefers-reduced-motion:
// reduce)` CSS AtlasNoteCardNode.module.css already gates its flip
// transition on. Needed wherever an animation duration is computed in
// JS rather than left to CSS (React Flow's fitView/fitBounds `duration`
// option, goal 0072 slice B's camera moves).
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(REDUCED_MOTION_QUERY).matches)
  useEffect(() => {
    const mql = window.matchMedia(REDUCED_MOTION_QUERY)
    const onChange = () => setReduced(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return reduced
}
