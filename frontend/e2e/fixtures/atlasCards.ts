import type { Locator, Page } from '@playwright/test'

// Shared card locators for the atlas spec family. Precise per-card
// matching: aria-label carries the exact title.
export function noteCard(page: Page, title: string): Locator {
  return page.locator(`[data-testid="atlas-note-card"][aria-label="Open ${title}"]`)
}

export function groupCard(page: Page, title: string): Locator {
  return page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator(`[aria-label="Zoom into ${title}"]`) })
}
