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

// A trackpad-shaped wheel at a locator's own point: a BURST of small
// deltas rather than one notch. A trackpad scroll (and the momentum
// tail a WKWebView keeps delivering after the fingers lift) reaches the
// page as many `deltaMode: 0` events of a few pixels each, and that
// shape is what a wheel contract has to hold under -- a single large
// notch can be absorbed by an engine's own clamp and prove nothing.
// The hover check runs once, the same way wheelAt's does; the pointer
// does not move across the burst.
export const TRACKPAD_WHEEL_STEPS = 10
export const TRACKPAD_WHEEL_DELTA = 8

export async function trackpadWheelAt(page: Page, locator: Locator, axis: 'left' | 'top', sign: 1 | -1, position?: { x: number; y: number }): Promise<void> {
  if (position) {
    await locator.hover({ position })
  } else {
    await locator.hover()
  }
  const step = sign * TRACKPAD_WHEEL_DELTA
  for (let i = 0; i < TRACKPAD_WHEEL_STEPS; i += 1) {
    await page.mouse.wheel(axis === 'left' ? step : 0, axis === 'left' ? 0 : step)
  }
}
