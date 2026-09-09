import type { Page } from '@playwright/test'

// SelectionBar's own bulk actions render through Primer's ActionBar
// (goal 0404 S1), which collapses whichever buttons don't fit into an
// auto-generated "More items" overflow menu -- the SAME nondeterministic
// overflow class fixtures/toolbarActions.ts's openToolbarAction already
// exists for on the Atlas board's own row, just triggered by a narrower
// bar (a companion-width run, or several bulk commands at once) instead
// of a crowded board row. A bounded direct click first, since a snapshot-
// then-click split can see "visible" and click an element that has since
// flipped to overflow-hidden.
const DIRECT_CLICK_TIMEOUT_MS = process.env.CI ? 5000 : 2000

export async function clickSelectionBarAction(page: Page, testid: string, label: string): Promise<void> {
  const direct = page.getByTestId(testid)
  try {
    await direct.click({ timeout: DIRECT_CLICK_TIMEOUT_MS })
    return
  } catch {
    // Overflowing (or not yet settled) -- fall through to "More items".
  }
  await page.getByRole('button', { name: 'More items' }).click()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
}
