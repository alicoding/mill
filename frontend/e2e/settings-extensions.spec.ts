import { test, expect } from './fixtures/server'
import { dragBetween } from './fixtures/atlasBoard'
import { clickAtlasTrayTool } from './fixtures/atlasTray'
import { deleteViaContextMenu, shapeDrawPoints, shapeObjects } from './fixtures/atlasShapeTool'
import { paletteDialog } from './fixtures/palette'

// Settings > Extensions (goal 0237 S2, extended by goal 0237 S3's
// rider and its own hands-on-review follow-up): a registry-derived
// list of every registered canvas NOUN -- every tray tool plus every
// tool-less noun (diagram, sheet -- native file-drop only, no tray
// button), each toggleable off. Grouped into three sections
// (Knowledge/Files/Drawing, one per registry `group` -- goal 0237 S3's
// review rider); each row's own title is the noun ("Shape"), never the
// command-verb phrase ("Draw a shape") that still surfaces in the tray
// tooltip and command palette. Shared pool: the only global state this
// spec writes (Shape's own disabled flag) is restored to its default
// (enabled) before the file ends, same cleanup discipline
// display-density.spec.ts already establishes for a Settings toggle in
// the shared pool; every board object created here is deleted here.
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
  // The row's own title is the bare noun, never the tray/palette's own
  // command-verb phrase ("Draw a shape").
  await expect(shapeRow.getByTestId('extensions-row-title')).toHaveText('Shape')
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
  // The group chip survives in the expanded view even though the
  // collapsed meta line below no longer repeats it.
  await expect(expanded.getByText('Drawing', { exact: true })).toBeVisible()

  // Collapses again on a second click of the same summary.
  await shapeRow.locator('summary').click()
  await expect(expanded).toBeHidden()
})

test('The list groups into three sections; every row title is a noun, and the collapsed meta line never repeats the group', async ({ page }) => {
  await page.goto('/')
  await openExtensionsSection(page)

  // Three sections, registry-derived, in knowledge/files/drawing order.
  const knowledge = page.getByTestId('extensions-group-knowledge')
  const files = page.getByTestId('extensions-group-file')
  const drawing = page.getByTestId('extensions-group-annotate')
  await expect(knowledge.getByRole('heading', { name: 'Knowledge' })).toBeVisible()
  await expect(files.getByRole('heading', { name: 'Files' })).toBeVisible()
  await expect(drawing.getByRole('heading', { name: 'Drawing' })).toBeVisible()

  // card/note/area/table land in Knowledge; image/diagram/sheet in
  // Files (image/diagram/sheet are the file-backed family); the
  // freehand-marking tools in Drawing.
  for (const id of ['card', 'note', 'area', 'table']) {
    await expect(knowledge.locator(`[data-testid="extensions-row"][data-extension-id="${id}"]`)).toBeVisible()
  }
  for (const id of ['image', 'diagram', 'sheet']) {
    await expect(files.locator(`[data-testid="extensions-row"][data-extension-id="${id}"]`)).toBeVisible()
  }
  for (const id of ['pencil', 'eraser', 'laser', 'shape']) {
    await expect(drawing.locator(`[data-testid="extensions-row"][data-extension-id="${id}"]`)).toBeVisible()
  }

  // Every row's own title is the bare noun, one word.
  const expectedTitles: Record<string, string> = {
    card: 'Card', note: 'Note', area: 'Area', table: 'Table', image: 'Image',
    pencil: 'Pencil', eraser: 'Eraser', laser: 'Laser', shape: 'Shape',
    diagram: 'Diagram', sheet: 'Sheet',
  }
  for (const [id, title] of Object.entries(expectedTitles)) {
    const row = page.locator(`[data-testid="extensions-row"][data-extension-id="${id}"]`)
    await expect(row.getByTestId('extensions-row-title')).toHaveText(title)
  }

  // The collapsed meta line states source/edit-route facts, never the
  // group word its own section heading already carries.
  const imageMeta = page.locator('[data-testid="extensions-row"][data-extension-id="image"]').getByTestId('extensions-row-meta')
  await expect(imageMeta).toHaveText('Backed by a file · Opens in your default app')
  const tableMeta = page.locator('[data-testid="extensions-row"][data-extension-id="table"]').getByTestId('extensions-row-meta')
  await expect(tableMeta).toHaveText('Live view of a List · Edits in place')
  const shapeMeta = page.locator('[data-testid="extensions-row"][data-extension-id="shape"]').getByTestId('extensions-row-meta')
  await expect(shapeMeta).toHaveText('Stored on the board')
})

test('The collapsed meta line stays single-line at 1000px viewport width', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 660 })
  await page.goto('/')
  await openExtensionsSection(page)

  // diagram's own meta line is the longest in the list (a file source
  // plus its per-object edit-route resolver's own generic phrase) --
  // the stress case for wrapping.
  const diagramMeta = page.locator('[data-testid="extensions-row"][data-extension-id="diagram"]').getByTestId('extensions-row-meta')
  await expect(diagramMeta).toBeVisible()
  const box = await diagramMeta.boundingBox()
  if (!box) throw new Error('extensions-row-meta has no bounding box')
  // A single line of this small-text token is well under 24px tall;
  // two wrapped lines would roughly double it.
  expect(box.height).toBeLessThan(24)
})

test('The toggle knob stays contained within its own row, even scrolled with a disclosure open (regression: it painted over the sticky search bar)', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 660 })
  await page.goto('/')
  await openExtensionsSection(page)

  // Scrolling to a row well below the fold pins the sticky search bar
  // (.filterRow, SettingsView.module.css) to the top of the scroll
  // pane -- the exact live condition the bug needed.
  const sheetRow = page.locator('[data-testid="extensions-row"][data-extension-id="sheet"]')
  await sheetRow.scrollIntoViewIfNeeded()
  await sheetRow.locator('summary').click()
  await expect(sheetRow.getByTestId('extensions-row-expanded')).toBeVisible()

  const searchBar = page.getByTestId('settings-filter')
  await expect(searchBar).toBeVisible()
  const box = await searchBar.boundingBox()
  if (!box) throw new Error('settings-filter has no bounding box')
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)
    return {
      isSearchBar: el?.closest('[data-testid="settings-filter"]') !== null,
      isToggleKnob: el?.className?.toString().includes('ToggleKnob') ?? false,
    }
  }, point)

  expect(hit.isToggleKnob).toBe(false)
  expect(hit.isSearchBar).toBe(true)
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
