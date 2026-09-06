import { test, expect } from './fixtures/server'
import { noteCard } from './fixtures/atlasCards'
import { contextMenu } from './fixtures/contextMenu'
import { paletteDialog } from './fixtures/palette'
import { cancelCreatePopover } from './fixtures/atlasBoard'

// Goal 0346 slice B: the Atlas selection is a shared context. The
// right-click menu and the command palette run the SAME registry
// command over the SAME selection; a data-driven item carries its
// target in the context. Shared pool: nothing here mutates seeded
// content (every popover is cancelled, every menu closed).

async function openAtlas(page: Parameters<typeof noteCard>[0]) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
}

test('a selected card: the palette and the right-click menu run one Open command over the ambient selection', async ({ page }) => {
  await openAtlas(page)
  const card = noteCard(page, 'Discovery workstream')
  const overlay = page.locator('[data-component="atlas-card-overlay"]')

  // Select it (a plain click selects, goal 0102), then run Open from
  // the palette: the command resolves the selection ambiently.
  await card.click()
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)
  await page.keyboard.press('Meta+/')
  await expect(paletteDialog(page)).toBeVisible()
  await paletteDialog(page).getByRole('combobox').fill('Open card')
  await paletteDialog(page).getByRole('option', { name: 'Open card', exact: true }).click()
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Discovery workstream')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  // The same command from the menu, over the same card.
  await card.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Open', { exact: true }).click()
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Discovery workstream')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  // With nothing selected the palette no longer offers it: the
  // command is honest about needing a card.
  await page.keyboard.press('Escape')
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0)
  await page.keyboard.press('Meta+/')
  await expect(paletteDialog(page)).toBeVisible()
  await paletteDialog(page).getByRole('combobox').fill('Open card')
  await expect(paletteDialog(page).getByRole('option', { name: 'Open card', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
})

test('a multi-selection: Group into new area runs through the registry and opens the area popover', async ({ page }) => {
  await openAtlas(page)
  const card = noteCard(page, 'Discovery workstream')
  await card.click()
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)
  // Select all (atlas.selectAll) -- every placed thing on this board.
  await page.keyboard.press('Meta+a')
  await expect.poll(async () => page.locator('.react-flow__node.selected').count()).toBeGreaterThan(1)

  await card.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Group into new area', { exact: true }).click()
  const popover = page.getByTestId('atlas-placement-popover')
  await expect(popover).toBeVisible()
  await cancelCreatePopover(popover)
  await expect(popover).not.toBeVisible()
})

test('an artery: "Open <card>" carries its target in the context -- the far end, not the selection', async ({ page }) => {
  await openAtlas(page)
  // A right-click on an edge selects nothing on the board; the item
  // names its own card, and each end opens ITS card.
  await page.locator('.react-flow__edge').first().click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0)
  await menu.getByText('Open Client records', { exact: true }).click()
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Client records')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()
})
