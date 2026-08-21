// The one definition of "user-scrollable" this repo has (goal 0156):
// computed overflow auto/scroll on an axis AND that axis's scroll
// extent actually exceeds its client extent. Extracted from
// useSettingsSectionSync.ts's own ancestor walk, which stopped one
// level too early on Primer's PageLayout.Content wrapper (its
// scrollHeight also exceeds its clientHeight -- any element with
// overflowing children reports that, regardless of its own overflow
// property -- so a height-only check alone is not sufficient; the
// overflow-value check is what actually distinguishes a real scroll
// container from an ancestor merely sized by overflowing content).
// Reused by the layout-fitness audit's own predicate
// (frontend/e2e/layoutFitnessPredicate.ts) so both consumers apply the
// SAME test -- never two hand-rolled copies drifting apart.
export function isScrollingOverflow(overflow: string, scrollExtent: number, clientExtent: number): boolean {
  return (overflow === 'auto' || overflow === 'scroll') && scrollExtent > clientExtent
}

// The vertical-axis convenience most DOM ancestor walks want: is this
// real Element itself the scroll container for its own overflow, not
// just a box whose content happens to be taller than its box.
export function isScrollContainer(el: Element): boolean {
  const overflowY = getComputedStyle(el).overflowY
  return isScrollingOverflow(overflowY, el.scrollHeight, el.clientHeight)
}
