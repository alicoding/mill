import { describe, expect, it } from 'vitest'
import { classifyScrollFitness, TRAPPED_OVERFLOW_THRESHOLD_PX, type ScrollFitnessMeasurement } from './layoutFitnessPredicate'

// Full classification table for the goal 0156 layout-fitness invariant
// (docs/goals/0156-frontend-fitness-functions.md): every case the
// custom axe check (layoutFitnessRule.ts) can hand this predicate,
// fed as plain measured numbers -- jsdom has no real layout, so this
// never constructs a DOM element.
function measurement(overrides: Partial<ScrollFitnessMeasurement>): ScrollFitnessMeasurement {
  return {
    overflowY: 'visible',
    overflowX: 'visible',
    scrollHeight: 100,
    clientHeight: 100,
    scrollWidth: 100,
    clientWidth: 100,
    isViewPane: false,
    hasScrollRegionAttr: false,
    hasClipIntentAncestor: false,
    hasScrollRegionDescendant: false,
    ...overrides,
  }
}

describe('classifyScrollFitness', () => {
  it('passes an ordinary non-scrolling, non-clipped element', () => {
    expect(classifyScrollFitness(measurement({}))).toEqual({ pass: true })
  })

  it('passes a declared scroller: .view-pane itself', () => {
    const m = measurement({ overflowY: 'auto', scrollHeight: 900, clientHeight: 400, isViewPane: true })
    expect(classifyScrollFitness(m)).toEqual({ pass: true })
  })

  it('passes a declared scroller: data-scroll-region attribute', () => {
    const m = measurement({ overflowY: 'auto', scrollHeight: 900, clientHeight: 400, hasScrollRegionAttr: true })
    expect(classifyScrollFitness(m)).toEqual({ pass: true })
  })

  it('fails an undeclared vertical scroller', () => {
    const m = measurement({ overflowY: 'auto', scrollHeight: 900, clientHeight: 400 })
    expect(classifyScrollFitness(m)).toEqual({ pass: false, kind: 'undeclared-scroller', axis: 'y' })
  })

  it('fails an undeclared horizontal scroller', () => {
    const m = measurement({ overflowX: 'scroll', scrollWidth: 900, clientWidth: 400 })
    expect(classifyScrollFitness(m)).toEqual({ pass: false, kind: 'undeclared-scroller', axis: 'x' })
  })

  it('is not a scroller at all when overflow is auto/scroll but nothing actually overflows', () => {
    // The Primer PageLayout.Content trap: scrollHeight === clientHeight
    // means nothing to scroll, regardless of the overflow value.
    const m = measurement({ overflowY: 'auto', scrollHeight: 400, clientHeight: 400 })
    expect(classifyScrollFitness(m)).toEqual({ pass: true })
  })

  it('passes a clipped element whose trapped delta sits under the threshold', () => {
    const m = measurement({ overflowY: 'hidden', scrollHeight: 100 + TRAPPED_OVERFLOW_THRESHOLD_PX, clientHeight: 100 })
    expect(classifyScrollFitness(m)).toEqual({ pass: true })
  })

  it('fails a clipped element whose trapped delta exceeds the threshold', () => {
    const deltaPx = TRAPPED_OVERFLOW_THRESHOLD_PX + 1
    const m = measurement({ overflowY: 'hidden', scrollHeight: 100 + deltaPx, clientHeight: 100 })
    expect(classifyScrollFitness(m)).toEqual({ pass: false, kind: 'trapped-overflow', deltaPx })
  })

  it('fails the same way for overflow-y: clip as for hidden', () => {
    const deltaPx = TRAPPED_OVERFLOW_THRESHOLD_PX + 1
    const m = measurement({ overflowY: 'clip', scrollHeight: 100 + deltaPx, clientHeight: 100 })
    expect(classifyScrollFitness(m)).toEqual({ pass: false, kind: 'trapped-overflow', deltaPx })
  })

  it('passes a large trapped delta exempted by data-clip-intent', () => {
    const deltaPx = TRAPPED_OVERFLOW_THRESHOLD_PX + 500
    const m = measurement({ overflowY: 'hidden', scrollHeight: 100 + deltaPx, clientHeight: 100, hasClipIntentAncestor: true })
    expect(classifyScrollFitness(m)).toEqual({ pass: true })
  })

  it('passes a large trapped delta exempted by a descendant data-scroll-region', () => {
    const deltaPx = TRAPPED_OVERFLOW_THRESHOLD_PX + 500
    const m = measurement({ overflowY: 'hidden', scrollHeight: 100 + deltaPx, clientHeight: 100, hasScrollRegionDescendant: true })
    expect(classifyScrollFitness(m)).toEqual({ pass: true })
  })
})
