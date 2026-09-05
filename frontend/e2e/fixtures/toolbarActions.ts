import type { Page } from '@playwright/test'

// The one helper every spec uses to reach a board-level toolbar action,
// wherever the chrome puts it (goal 0355). The row itself now holds
// only the view switcher, Share and the companion toggle; every action
// that acts on the whole board is a seat in the Board menu. Callers name
// the action by the testid it has always had and this helper knows
// where that seat lives, so a chrome reshuffle is one edit here rather
// than one per spec.

// Actions seated in the Board menu. Their testids are declared on the
// menu items themselves (shared/atlasBoardCommands.ts), so the click is
// just "open the menu, then click the item".
const BOARD_MENU_ACTIONS = new Set([
  'atlas-auto-arrange',
  'atlas-import',
  'atlas-add-from-folder',
  'atlas-export-json',
  'atlas-export-drawio',
  'atlas-open-kinds',
])

// Opening the Board menu is itself what a spec asks for under the name
// the old Export button carried, before clicking an item inside it.
const BOARD_MENU_TRIGGER = 'atlas-export'

// Every action still reachable directly in the row: the view switcher's
// five segments, Share, and the companion toggle.
const ROW_ACTIONS = new Set([
  'atlas-open-board',
  'atlas-open-contents',
  'atlas-open-matrix',
  'atlas-open-coverage',
  'atlas-open-roadmap',
  'atlas-space-share',
  'atlas-open-companion',
])

// The label Primer's ActionBar renders an overflowed item under -- an
// overflowed item loses its data-testid (ActionBar re-renders it as a
// plain ActionList.Item), so the label is the only stable way to find
// it once it is off the row.
const OVERFLOW_LABELS: Record<string, string> = {
  'atlas-space-share': 'Share',
  'atlas-open-companion': 'AI',
}

// A single bounded click rather than an isVisible() snapshot followed by
// a click: Primer's ActionBar decides overflow from a ResizeObserver
// measurement that can still be in flight, so a snapshot-then-click
// split can see "visible" and then click an element that has since
// flipped to overflow-hidden, hanging for the full actionability
// timeout. One bounded call either succeeds inside the window or fails
// once, cleanly, into the fallback.
const ROW_CLICK_TIMEOUT_MS = process.env.CI ? 5000 : 2000

export async function openBoardMenu(page: Page): Promise<void> {
  const overlay = page.getByTestId('atlas-board-menu-overlay')
  if (await overlay.isVisible()) return
  await page.getByTestId('atlas-board-menu').click()
  await overlay.waitFor({ state: 'visible' })
}

export async function openToolbarAction(page: Page, testid: string): Promise<void> {
  if (testid === BOARD_MENU_TRIGGER) {
    await openBoardMenu(page)
    return
  }
  if (BOARD_MENU_ACTIONS.has(testid)) {
    await openBoardMenu(page)
    await page.getByTestId(testid).click()
    return
  }
  if (!ROW_ACTIONS.has(testid)) throw new Error(`openToolbarAction: "${testid}" is not a known toolbar action`)
  const locator = page.getByTestId(testid)
  try {
    await locator.click({ timeout: ROW_CLICK_TIMEOUT_MS })
    return
  } catch {
    // Overflowing (or not yet settled) -- fall through to the "More
    // items" menu below.
  }
  const label = OVERFLOW_LABELS[testid]
  if (!label) throw new Error(`openToolbarAction: "${testid}" is not clickable in its row and never overflows`)
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
