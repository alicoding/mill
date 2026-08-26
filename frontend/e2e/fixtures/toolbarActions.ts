import type { Page } from '@playwright/test'

// Every toolbar action Primer's ActionBar (goal 0216) can move into its
// own "More items" overflow menu, mapped to the exact visible label text
// the overflow's ActionList renders it under -- an overflowed item loses
// its data-testid (ActionBar re-renders it as a plain ActionList.Item,
// not a clone of the original element), so the label is the only stable
// way to find it once it's off the row.
const TOOLBAR_ACTION_LABELS: Record<string, string> = {
  'atlas-auto-arrange': 'Auto-arrange',
  'atlas-import': 'Import',
  'atlas-export': 'Export',
  'atlas-add-from-folder': 'Add from folder…',
  'atlas-space-share': 'Share',
  'atlas-open-matrix': 'Matrix',
  'atlas-open-coverage': 'Coverage',
  'atlas-open-roadmap': 'Roadmap',
  'atlas-open-kinds': 'Kinds',
  'atlas-open-companion': 'AI',
}

// Clicks a toolbar action reachable either directly in its ActionBar row
// or, once the row shrinks past its own natural width, inside that
// ActionBar's own "More items" overflow menu (goal 0216) -- a plain
// `getByTestId(id).click()` on an overflowed item waits its full
// actionability timeout for an element that will never become visible,
// which is what made dozens of specs slow-fail once CI's viewport
// started overflowing the row. Tries each visible "More items" button in
// turn since the target's own ActionBar isn't known to the caller.
export async function openToolbarAction(page: Page, testid: string): Promise<void> {
  const locator = page.getByTestId(testid)
  if (await locator.isVisible()) {
    await locator.click()
    return
  }
  const label = TOOLBAR_ACTION_LABELS[testid]
  if (!label) throw new Error(`openToolbarAction: no overflow label registered for "${testid}"`)
  const moreButtons = page.getByRole('button', { name: 'More items' })
  const count = await moreButtons.count()
  for (let i = 0; i < count; i++) {
    const more = moreButtons.nth(i)
    if (!(await more.isVisible())) continue
    await more.click()
    const item = page.getByRole('menuitem', { name: label, exact: true })
    if (await item.isVisible()) {
      await item.click()
      return
    }
    await page.keyboard.press('Escape')
  }
  throw new Error(`openToolbarAction: "${testid}" not found in its row or any overflow menu (label "${label}")`)
}
