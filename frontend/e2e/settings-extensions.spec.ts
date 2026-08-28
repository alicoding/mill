import { test, expect } from './fixtures/server'
import { dragBetween } from './fixtures/atlasBoard'
import { clickAtlasTrayTool } from './fixtures/atlasTray'
import { deleteViaContextMenu, shapeDrawPoints, shapeObjects } from './fixtures/atlasShapeTool'
import { paletteDialog } from './fixtures/palette'

// Settings > Extensions (goal 0237 S2, extended by goal 0237 S3's
// rider): a registry-derived list of every registered canvas NOUN --
// every tray tool plus every tool-less noun (diagram, sheet -- native
// file-drop only, no tray button), each toggleable off. Shared pool:
// the only global state this spec writes (Shape's own disabled flag)
// is restored to its default (enabled) before the file ends, same
// cleanup discipline display-density.spec.ts already establishes for a
// Settings toggle in the shared pool; every board object created here
// is deleted here.
//
// Disabling diagram/sheet gates useAtlasNativeFileDrop.ts's own drop
// routing (a disabled drop falls through to the plain-card path). The
// OS drop GESTURE itself is a structural e2e gap (testing.md's own
// manual-only registry: WindowFilesDropped needs a real
// *WebviewWindow, which server-mode Playwright's connection is not),
// so the routing DECISION is proven at the honest layer instead --
// useAtlasNativeFileDrop.test.ts's resolveFileDropKind Vitest suite --
// and this spec only proves the row/toggle exists and states its
// narrower scope.

async function openExtensionsSection(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByTestId('settings-view')).toBeVisible()
  // Every section renders in the DOM at once (SettingsView.tsx's own
  // one-page-plus-synced-TOC shape) -- no TOC click needed to reach it.
  await expect(page.getByTestId('extensions-list')).toBeVisible()
}

test('The section explains where extensions come from today', async ({ page }) => {
  await page.goto('/')
  await openExtensionsSection(page)
  await expect(page.getByTestId('extensions-install-story')).toHaveText(
    'Extensions ship with Mill today. Installing your own arrives with the plugin loader.',
  )
})

test('A row expands to show its description, an honest reach line, and the app version', async ({ page }) => {
  await page.goto('/')
  await openExtensionsSection(page)

  const shapeRow = page.locator('[data-testid="extensions-row"][data-extension-id="shape"]')
  const expanded = shapeRow.getByTestId('extensions-row-expanded')
  await expect(expanded).toBeHidden()

  // Native <details>/<summary> (goal 0211's plugin-manager UX slice):
  // clicking the summary text opens the disclosure without touching the
  // enable/disable toggle, which lives outside the summary specifically
  // so it never double-fires the native expand/collapse.
  await shapeRow.locator('summary').click()
  await expect(expanded).toBeVisible()
  await expect(shapeRow.getByTestId('extensions-row-description')).toHaveText('Draws a rectangle, ellipse, or arrow.')
  await expect(shapeRow.getByTestId('extensions-row-reach')).toHaveText('Reaches nothing outside Mill.')
  await expect(shapeRow.getByTestId('extensions-row-version')).toHaveText(/^Ships with Mill v/)

  // Collapses again on a second click of the same summary.
  await shapeRow.locator('summary').click()
  await expect(expanded).toBeHidden()
})

test('Turn all off empties the tray of every non-built-in tool; turn all on restores them', async ({ page }) => {
  await page.goto('/')
  await openExtensionsSection(page)

  const toggleAll = page.getByTestId('extensions-toggle-all')
  await expect(toggleAll).toHaveText('Turn all off')
  await toggleAll.click()
  await expect(toggleAll).toHaveText('Turn all on')

  // Every row but card now shows its toggle off -- including the
  // tool-less nouns (diagram, sheet), which have no tray button to
  // empty but still participate in the bulk toggle.
  for (const id of ['note', 'area', 'table', 'image', 'pencil', 'eraser', 'laser', 'shape', 'diagram', 'sheet']) {
    const toggle = page.locator(`[data-testid="extensions-row"][data-extension-id="${id}"]`).getByTestId('extensions-row-toggle').getByRole('button')
    await expect(toggle).toHaveAttribute('data-checked', 'false')
  }

  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  for (const id of ['note', 'area', 'table', 'image', 'shape', 'pencil', 'eraser', 'laser']) {
    await expect(page.getByTestId(`atlas-tray-${id}`)).toHaveCount(0)
  }
  // card is the kernel object, never affected by the bulk toggle.
  await expect(page.getByTestId('atlas-tray-card')).toBeVisible()

  // Restore -- shared-pool cleanup discipline.
  await page.getByRole('link', { name: 'Settings' }).click()
  await openExtensionsSection(page)
  await expect(toggleAll).toHaveText('Turn all on')
  await toggleAll.click()
  await expect(toggleAll).toHaveText('Turn all off')
  for (const id of ['note', 'area', 'table', 'image', 'pencil', 'eraser', 'laser', 'shape', 'diagram', 'sheet']) {
    const toggle = page.locator(`[data-testid="extensions-row"][data-extension-id="${id}"]`).getByTestId('extensions-row-toggle').getByRole('button')
    await expect(toggle).toHaveAttribute('data-checked', 'true')
  }
})

test('Extensions section lists every registered canvas tool; the built-in card row has no toggle', async ({ page }) => {
  await page.goto('/')
  await openExtensionsSection(page)

  // Every ATLAS_TOOLS member (atlas/atlasTools.ts) plus every
  // tool-less noun (diagram, sheet) gets exactly one row -- card, note,
  // area, table, image, pencil, eraser, laser, shape, diagram, sheet.
  await expect(page.getByTestId('extensions-row')).toHaveCount(11)

  const cardRow = page.locator('[data-testid="extensions-row"][data-extension-id="card"]')
  await expect(cardRow).toBeVisible()
  await expect(cardRow.getByTestId('extensions-row-built-in')).toBeVisible()
  await expect(cardRow.getByTestId('extensions-row-toggle')).toHaveCount(0)

  // A non-card row shows the toggle instead, on by default.
  const tableRow = page.locator('[data-testid="extensions-row"][data-extension-id="table"]')
  const tableToggle = tableRow.getByTestId('extensions-row-toggle').getByRole('button')
  await expect(tableToggle).toHaveAttribute('data-checked', 'true')
})

test('A tool-less noun (diagram, sheet) gets a row with a toggle and states its narrower disable scope', async ({ page }) => {
  await page.goto('/')
  await openExtensionsSection(page)

  const diagramRow = page.locator('[data-testid="extensions-row"][data-extension-id="diagram"]')
  await expect(diagramRow).toBeVisible()
  await expect(diagramRow.getByTestId('extensions-row-toggle').getByRole('button')).toHaveAttribute('data-checked', 'true')
  await diagramRow.locator('summary').click()
  await expect(diagramRow.getByTestId('extensions-row-description')).toHaveText(
    'View and edit diagrams — draw.io files open in the real editor.',
  )
  await expect(diagramRow.getByTestId('extensions-row-disable-scope')).toHaveText(
    'Turning this off stops new diagrams from landing on drop and closes the built-in editor. Diagrams already on the board keep working.',
  )

  const sheetRow = page.locator('[data-testid="extensions-row"][data-extension-id="sheet"]')
  await expect(sheetRow).toBeVisible()
  await expect(sheetRow.getByTestId('extensions-row-toggle').getByRole('button')).toHaveAttribute('data-checked', 'true')
  await sheetRow.locator('summary').click()
  await expect(sheetRow.getByTestId('extensions-row-description')).toHaveText(
    'Preview spreadsheets and CSV files dropped onto the board.',
  )
  await expect(sheetRow.getByTestId('extensions-row-disable-scope')).toHaveText(
    'Turning this off stops new sheets from landing on drop. Sheets already on the board keep working, including opening in your default app.',
  )

  // A tray tool's row never shows a disable-scope note -- its toggle's
  // scope (tray button + palette command) is already the standing
  // default every row implicitly shares.
  const tableRow = page.locator('[data-testid="extensions-row"][data-extension-id="table"]')
  await tableRow.locator('summary').click()
  await expect(tableRow.getByTestId('extensions-row-disable-scope')).toHaveCount(0)
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
