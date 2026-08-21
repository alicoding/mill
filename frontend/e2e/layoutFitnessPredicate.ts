import { isScrollingOverflow } from '../src/shared/scrollContainer'

// Goal 0156's layout-fitness invariant, v1: every user-scrollable
// element inside `.view-pane` is a NAMED surface (declared via
// `.view-pane` itself or a `data-scroll-region` attribute), and no
// element clamps (`overflow-y: hidden`/`clip`) more than
// TRAPPED_OVERFLOW_THRESHOLD_PX of real content behind it unless the
// clamp is declared deliberate (`data-clip-intent`, on the element or
// an ancestor) or a descendant already owns the overflow via its own
// `data-scroll-region`. Element-measurement inputs in, verdict out --
// no DOM Element parameter, since this same function is fed real
// getComputedStyle/scrollHeight readings from inside a live page (the
// custom axe check, layoutFitnessRule.ts) and plain numbers from a
// Vitest unit test (jsdom has no layout, so it cannot produce a real
// scrollHeight/clientHeight pair).
export interface ScrollFitnessMeasurement {
  overflowY: string
  overflowX: string
  scrollHeight: number
  clientHeight: number
  scrollWidth: number
  clientWidth: number
  // True for the one element this repo treats as the intended scroller
  // by construction (`.view-pane`, frontend/src/app/index.css) --
  // never needs its own data-scroll-region stamp.
  isViewPane: boolean
  hasScrollRegionAttr: boolean
  hasClipIntentAncestor: boolean
  hasScrollRegionDescendant: boolean
}

export type ScrollFitnessVerdict =
  | { pass: true }
  | { pass: false; kind: 'undeclared-scroller'; axis: 'y' | 'x' }
  | { pass: false; kind: 'trapped-overflow'; deltaPx: number }

// Sits well above ellipsis/line-clamp deltas (a truncated single line
// or a 2-3 line clamp) and well below a genuinely trapped flow page --
// see docs/goals/0156-frontend-fitness-functions.md for the calibration.
export const TRAPPED_OVERFLOW_THRESHOLD_PX = 160

export function classifyScrollFitness(m: ScrollFitnessMeasurement): ScrollFitnessVerdict {
  const scrollsY = isScrollingOverflow(m.overflowY, m.scrollHeight, m.clientHeight)
  const scrollsX = isScrollingOverflow(m.overflowX, m.scrollWidth, m.clientWidth)
  if ((scrollsY || scrollsX) && !m.isViewPane && !m.hasScrollRegionAttr) {
    return { pass: false, kind: 'undeclared-scroller', axis: scrollsY ? 'y' : 'x' }
  }

  if (m.overflowY === 'hidden' || m.overflowY === 'clip') {
    const deltaPx = m.scrollHeight - m.clientHeight
    if (deltaPx > TRAPPED_OVERFLOW_THRESHOLD_PX && !m.hasClipIntentAncestor && !m.hasScrollRegionDescendant) {
      return { pass: false, kind: 'trapped-overflow', deltaPx }
    }
  }

  return { pass: true }
}
