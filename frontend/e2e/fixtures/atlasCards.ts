import type { Locator, Page } from '@playwright/test'

// Shared card locators for the atlas spec family. Precise per-card
// matching: a plain hasText substring filter is unreliable since a
// card's own BACK face can legitimately contain another card's title
// (its "<kind> -> <other title>" link row) -- aria-label carries the
// exact title instead.
export function noteCard(page: Page, title: string): Locator {
  return page.locator(`[data-testid="atlas-note-card"][aria-label="Flip ${title}"]`)
}

export function groupCard(page: Page, title: string): Locator {
  return page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator(`[aria-label="Zoom into ${title}"]`) })
}
