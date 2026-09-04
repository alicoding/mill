import type { Locator, Page } from '@playwright/test'

// Dispatches a real mouse wheel event at a locator's own point --
// Playwright has no locator-level wheel API (page.mouse.wheel is the
// only one), so the START point is actionability-checked the same way
// every other raw mouse primitive in this suite is: `locator.hover
// ({position})` immediately before the wheel, retargeting the check to
// the exact pixel the wheel event will target (goal 0184 RESEARCH
// VERDICT). `position` defaults to the locator's own center.
export async function wheelAt(page: Page, locator: Locator, deltaX: number, deltaY: number, position?: { x: number; y: number }): Promise<void> {
  if (position) {
    await locator.hover({ position })
  } else {
    await locator.hover()
  }
  await page.mouse.wheel(deltaX, deltaY)
}

// Pinch-zoom over a locator. A trackpad pinch reaches the page as a
// wheel event carrying ctrlKey, and the keyboard modifier is the only
// way to produce that pairing from Playwright's input stack -- so this
// is the same checked gesture wheelAt performs, with Control held
// across it. Keeping it here rather than inline in a spec is what
// keeps the raw page.mouse call inside a fixture (goal 0184).
export async function zoomWheelAt(page: Page, locator: Locator, deltaY: number, position?: { x: number; y: number }): Promise<void> {
  await page.keyboard.down('Control')
  try {
    await wheelAt(page, locator, 0, deltaY, position)
  } finally {
    await page.keyboard.up('Control')
  }
}
