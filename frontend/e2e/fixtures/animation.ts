import { expect, type Locator } from '@playwright/test'

// React Flow's Fit View/Zoom Out/drill animate the `.react-flow__viewport`
// element's own inline transform via d3-zoom's JS-driven interpolation
// (not a CSS transition), so a fixed sleep after clicking either control
// is a real flake risk under CPU contention -- it can resolve before the
// pan/zoom settles, leaving a subsequent boundingBox() read (and any
// click position derived from it) racing an in-flight transform. Polling
// the transform string until it's unchanged across two consecutive reads
// waits on the actual condition instead of a guessed duration -- promoted
// from step-detail-overlay.spec.ts (goal 0080's burn-down) after the
// audit found the same race, and the same fixed-sleep workaround for it,
// duplicated across a dozen canvas spec files.
export async function waitForViewportStable(panel: Locator, timeout = 5_000): Promise<void> {
  const viewport = panel.locator('.react-flow__viewport')
  let previous: string | null = null
  await expect
    .poll(async () => {
      const transform = await viewport.evaluate((el) => (el as HTMLElement).style.transform)
      const stable = previous !== null && transform === previous
      previous = transform
      return stable
    }, { timeout })
    .toBe(true)
}

// Clicks a locator at a fractional position within its own bounding box
// (fx/fy in [0, 1] -- 0.5/0.5 is dead center) rather than Playwright's
// default center click, for elements where the center point resolves to
// a different nested element (a card that flips to show its back face,
// say) -- generalized from atlas-page.spec.ts's own clickFrameBody.
export async function clickAtFraction(locator: Locator, fx: number, fy: number): Promise<void> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('clickAtFraction: expected the element to be measurable')
  await locator.click({ position: { x: box.width * fx, y: box.height * fy } })
}
