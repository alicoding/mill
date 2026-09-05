import { test, expect } from './fixtures/server'
import type { Page } from '@playwright/test'
import { gotoAppReady } from './fixtures/appReady'
import { openBoardMenu } from './fixtures/toolbarActions'

// The board's chrome as goal 0355 shipped it: one Board menu for
// whole-board actions, one view switcher, Share standing alone, and a
// creation dock of exactly seven buttons whose flyouts and searchable
// More panel hold everything else. Every assertion here is about the
// chrome itself -- what it shows and what clicking it does -- so the
// shared worker pool is the right home; nothing reads global app state
// and every armed tool is disarmed again before the test ends.

const DOCK_BUTTONS = [
  'atlas-tray-card',
  'atlas-tray-note',
  'atlas-tray-area',
  'atlas-tray-table',
  'atlas-tray-media-group',
  'atlas-tray-annotate-group',
  'atlas-tray-more',
]

async function openAtlas(page: Page) {
  await gotoAppReady(page)
  const mobileToggle = page.getByTestId('mobile-nav-toggle')
  if (await mobileToggle.isVisible()) await mobileToggle.click()
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-creation-tray')).toBeVisible()
}

test('the Board menu shows its four bands and runs Auto-arrange through the registry', async ({ page }) => {
  await openAtlas(page)
  await openBoardMenu(page)

  for (const band of ['Arrange', 'Add', 'Export', 'Structure']) {
    await expect(page.getByTestId('atlas-board-menu-overlay').getByText(band, { exact: true }), band).toBeVisible()
  }

  // The real effect, not the item's presence: Auto-arrange re-seats the
  // board, which React Flow writes as a transform on every node.
  await page.getByTestId('atlas-auto-arrange').click()
  const anyNode = page.locator('.react-flow__node').first()
  await expect.poll(async () => (await anyNode.evaluate((el) => (el as HTMLElement).style.transform)) ?? '').toContain('translate')
})

test('the view switcher moves between the board and its projections, and back', async ({ page }) => {
  await openAtlas(page)
  const switcher = page.getByTestId('atlas-view-switcher')
  await expect(switcher).toBeVisible()
  await expect(page.getByTestId('atlas-open-board')).toHaveAttribute('aria-pressed', 'true')

  await page.getByTestId('atlas-open-contents').click()
  await expect(page.locator('[data-component="atlas-contents-dialog"]')).toBeVisible()
  // The switcher reports where you are, not just where you clicked:
  // its state is derived from what is actually on screen, so dismissing
  // a projection any other way puts it back on Board.
  await expect(page.getByTestId('atlas-open-contents')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-component="atlas-contents-dialog"]')).not.toBeVisible()
  await expect(page.getByTestId('atlas-open-board')).toHaveAttribute('aria-pressed', 'true')

  await page.getByTestId('atlas-open-matrix').click()
  await expect(page.locator('[data-component="atlas-matrix-dialog"]')).toBeVisible()
  await expect(page.getByTestId('atlas-open-matrix')).toHaveAttribute('aria-pressed', 'true')

  await page.keyboard.press('Escape')
  await expect(page.locator('[data-component="atlas-matrix-dialog"]')).not.toBeVisible()
  await expect(page.getByTestId('atlas-open-board')).toHaveAttribute('aria-pressed', 'true')
})

test('the dock shows exactly seven buttons, and the Media flyout offers Image and a file', async ({ page }) => {
  await openAtlas(page)
  const dock = page.getByTestId('atlas-creation-tray')
  await expect(dock.locator('button')).toHaveCount(DOCK_BUTTONS.length)
  for (const testid of DOCK_BUTTONS) {
    await expect(dock.getByTestId(testid), testid).toBeVisible()
  }

  await page.getByTestId('atlas-tray-media-group').click()
  await expect(page.getByTestId('atlas-tray-image')).toBeVisible()
  await expect(page.getByTestId('atlas-tray-from-file')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('a bare letter key still arms its tool, dock button or not', async ({ page }) => {
  await openAtlas(page)
  await page.getByTestId('atlas-board').click({ position: { x: 8, y: 8 } })

  await page.keyboard.press('c')
  await expect(page.getByTestId('atlas-tray-card')).toHaveAttribute('data-armed', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('atlas-tray-card')).toHaveAttribute('data-armed', 'false')

  // Image lives inside the Media flyout now, and its own key still
  // arms it -- which gives its button the flyout's slot.
  await page.keyboard.press('i')
  await expect(page.getByTestId('atlas-tray-image')).toHaveAttribute('data-armed', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('atlas-tray-media-group')).toBeVisible()
})

test('the More panel finds a tool by name, arms it, and remembers it', async ({ page }) => {
  await openAtlas(page)
  await page.getByTestId('atlas-tray-more').click()
  const panel = page.getByTestId('atlas-more-panel')
  await expect(panel).toBeVisible()

  // Every registered tool is listed, dock-visible ones included.
  await expect(page.getByTestId('atlas-more-tool-card')).toBeVisible()

  await page.getByTestId('atlas-more-search').fill('note')
  await expect(page.getByTestId('atlas-more-tool-note')).toBeVisible()
  await expect(page.getByTestId('atlas-more-tool-card')).not.toBeVisible()

  await page.getByTestId('atlas-more-search').fill('zzznothing')
  await expect(page.getByTestId('atlas-more-empty')).toBeVisible()

  // A plugin's own tool is found the same way, and says where it came
  // from -- the whole point of the panel: an extension installed later
  // is reachable with no code change to the dock.
  await page.getByTestId('atlas-more-search').fill('pencil')
  await expect(page.getByTestId('atlas-more-tool-pencil')).toBeVisible()
  await expect(page.getByTestId('atlas-more-tool-pencil')).toContainText('From Drawing')

  await page.getByTestId('atlas-more-search').fill('note')
  await page.getByTestId('atlas-more-tool-note').click()
  await expect(panel).not.toBeVisible()
  await expect(page.getByTestId('atlas-tray-note')).toHaveAttribute('data-armed', 'true')
  await page.keyboard.press('Escape')

  // Recents remembers what was just picked, and the category chips
  // narrow the list to one family.
  await page.getByTestId('atlas-tray-more').click()
  await expect(page.getByTestId('atlas-more-recent-note')).toBeVisible()
  await page.getByTestId('atlas-more-category-media').click()
  await expect(page.getByTestId('atlas-more-tool-image')).toBeVisible()
  await expect(page.getByTestId('atlas-more-tool-card')).not.toBeVisible()
  await page.keyboard.press('Escape')
})
