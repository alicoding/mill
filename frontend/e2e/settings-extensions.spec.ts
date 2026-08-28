import { test, expect } from './fixtures/server'
import { dragBetween } from './fixtures/atlasBoard'
import { clickAtlasTrayTool } from './fixtures/atlasTray'
import { deleteViaContextMenu, shapeDrawPoints, shapeObjects } from './fixtures/atlasShapeTool'
import { paletteDialog } from './fixtures/palette'

// Settings > Extensions (goal 0237 S2): a registry-derived list of
// every canvas tool, each toggleable off. Shared pool: the only global
// state this spec writes (Shape's own disabled flag) is restored to
// its default (enabled) before the file ends, same cleanup discipline
// display-density.spec.ts already establishes for a Settings toggle in
// the shared pool; every board object created here is deleted here.

async function openExtensionsSection(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByTestId('settings-view')).toBeVisible()
  // Every section renders in the DOM at once (SettingsView.tsx's own
  // one-page-plus-synced-TOC shape) -- no TOC click needed to reach it.
  await expect(page.getByTestId('extensions-list')).toBeVisible()
}

test('Extensions section lists every registered canvas tool; the built-in card row has no toggle', async ({ page }) => {
  await page.goto('/')
  await openExtensionsSection(page)

  // Every ATLAS_TOOLS member (atlas/atlasTools.ts) gets exactly one
  // row -- card, note, area, table, image, pencil, eraser, laser, shape.
  await expect(page.getByTestId('extensions-row')).toHaveCount(9)

  const cardRow = page.locator('[data-testid="extensions-row"][data-extension-id="card"]')
  await expect(cardRow).toBeVisible()
  await expect(cardRow.getByTestId('extensions-row-built-in')).toBeVisible()
  await expect(cardRow.getByTestId('extensions-row-toggle')).toHaveCount(0)

  // A non-card row shows the toggle instead, on by default.
  const tableRow = page.locator('[data-testid="extensions-row"][data-extension-id="table"]')
  const tableToggle = tableRow.getByTestId('extensions-row-toggle').getByRole('button')
  await expect(tableToggle).toHaveAttribute('data-checked', 'true')
})

test('Disabling a tool removes it from the tray and palette, keeps existing objects rendering, and persists across reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  // A shape placed BEFORE the tool is disabled -- proves disabling
  // never touches already-created objects.
  await clickAtlasTrayTool(page, 'atlas-tray-shape')
  const picker = page.getByTestId('atlas-shape-style-picker')
  await expect(picker).toBeVisible()
  const draw = await shapeDrawPoints(page, board, picker)
  await dragBetween(page, draw.from, draw.to)
  const shapes = shapeObjects(page)
  await expect(shapes).toHaveCount(1)

  // Disable Shape from Settings.
  await openExtensionsSection(page)
  const shapeRow = page.locator('[data-testid="extensions-row"][data-extension-id="shape"]')
  const shapeToggle = shapeRow.getByTestId('extensions-row-toggle').getByRole('button')
  await expect(shapeToggle).toHaveAttribute('data-checked', 'true')
  await shapeToggle.click()
  await expect(shapeToggle).toHaveAttribute('data-checked', 'false')

  // Tray: the button is gone entirely (never shown dimmed).
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(board).toBeVisible()
  await expect(page.getByTestId('atlas-tray-shape')).toHaveCount(0)

  // The object placed earlier still renders untouched.
  await expect(shapeObjects(page)).toHaveCount(1)

  // Palette: the creation command is gone too (Cmd+/ opens the global
  // palette even on the atlas surface, since Cmd+K is atlas.jump there).
  await page.keyboard.press('Meta+/')
  await expect(paletteDialog(page)).toBeVisible()
  await paletteDialog(page).getByRole('combobox').fill('Draw a shape')
  await expect(paletteDialog(page).getByRole('option', { name: 'Draw a shape' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // Persists across reload.
  await page.reload()
  await openExtensionsSection(page)
  const shapeToggleAfterReload = page.locator('[data-testid="extensions-row"][data-extension-id="shape"]').getByTestId('extensions-row-toggle').getByRole('button')
  await expect(shapeToggleAfterReload).toHaveAttribute('data-checked', 'false')

  // Cleanup: re-enable Shape, delete the object this test created.
  await shapeToggleAfterReload.click()
  await expect(shapeToggleAfterReload).toHaveAttribute('data-checked', 'true')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(board).toBeVisible()
  // Shape lives in the tray's collapsed Annotate group -- opening the
  // drawer is how clickAtlasTrayTool itself reaches it (fixtures/atlasTray.ts).
  await page.getByTestId('atlas-tray-annotate-group').click()
  await expect(page.getByTestId('atlas-tray-shape')).toBeVisible()
  await page.keyboard.press('Escape')
  await deleteViaContextMenu(page, shapeObjects(page).first())
  await expect(shapeObjects(page)).toHaveCount(0)
})
