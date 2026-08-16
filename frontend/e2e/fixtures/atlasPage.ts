import type { Page } from '@playwright/test'

// The card page's edit affordances live behind a collapsed <details>
// disclosure (the page reads first, edits on demand) -- any test
// reaching an atlas-overlay-* edit field or Save/Delete opens it
// first. Idempotent: clicking only when actually closed, so tests
// that open the page twice can call this unconditionally.
export async function openCardPageEdit(page: Page): Promise<void> {
  const details = page.getByTestId('atlas-page-edit-section')
  const isOpen = await details.evaluate((el) => (el as HTMLDetailsElement).open)
  if (!isOpen) await page.getByTestId('atlas-page-edit-toggle').click()
}
