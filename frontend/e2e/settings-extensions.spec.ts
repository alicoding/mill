import { test, expect } from './fixtures/server'
import { dragBetween } from './fixtures/atlasBoard'
import { clickAtlasTrayTool } from './fixtures/atlasTray'
import { deleteViaContextMenu, shapeDrawPoints, shapeObjects } from './fixtures/atlasShapeTool'
import { paletteDialog } from './fixtures/palette'

// Settings > Extensions (goal 0237 S2/S3, re-shaped by goal 0252): a
// registry-derived list of every registered compiled-in NOUN -- tray
// tools plus tool-less nouns (diagram, sheet) -- each toggleable off,
// grouped by registry `group` (empty groups hide). The drawing tools
// are NOT rows here anymore: they live in the bundled Drawing runtime
// plugin, whose ONE row renders in the installed-plugins section with
// the manifest's own metadata. Shared pool: every global flag this
// spec writes (a noun's disabled flag, the Drawing plugin's disabled
// flag) is restored to its default before the file ends; every board
// object created here is deleted here.
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
    'These extensions ship with Mill. Install more under Installed plugins below.',
  )
})

test('A row expands to show its description, an honest reach line, and the app version', async ({ page }) => {
  await page.goto('/')
  await openExtensionsSection(page)

  const imageRow = page.locator('[data-testid="extensions-row"][data-extension-id="image"]')
  // The row's own title is the bare noun, never the tray/palette's own
  // command-verb phrase ("Add an image").
  await expect(imageRow.getByTestId('extensions-row-title')).toHaveText('Image')
  const expanded = imageRow.getByTestId('extensions-row-expanded')
  await expect(expanded).toBeHidden()

  // Native <details>/<summary> (goal 0211's plugin-manager UX slice):
  // clicking the summary text opens the disclosure without touching the
  // enable/disable toggle, which lives outside the summary specifically
  // so it never double-fires the native expand/collapse.
  await imageRow.locator('summary').click()
  await expect(expanded).toBeVisible()
  await expect(imageRow.getByTestId('extensions-row-description')).toHaveText('Adds an image from your files or the clipboard.')
  await expect(imageRow.getByTestId('extensions-row-reach')).toHaveText('Reaches nothing outside Mill.')
  await expect(imageRow.getByTestId('extensions-row-version')).toHaveText(/^Ships with Mill v/)
  // The group chip survives in the expanded view even though the
  // collapsed meta line below no longer repeats it (the per-row chip
  // stays singular where the section heading is plural).
  await expect(expanded.getByText('File', { exact: true })).toBeVisible()

  // Collapses again on a second click of the same summary.
  await imageRow.locator('summary').click()
  await expect(expanded).toBeHidden()
})

test('The list groups into sections; every row title is a noun, and the drawing tools live in the plugin row instead', async ({ page }) => {
  await page.goto('/')
  await openExtensionsSection(page)

  // Two sections, registry-derived, in knowledge/files order. The
  // Drawing section is GONE (goal 0252): with the freehand tools
  // demoted into the Drawing plugin no compiled-in noun declares
  // group 'annotate', and an empty group hides rather than rendering
  // a heading over nothing.
  const knowledge = page.getByTestId('extensions-group-knowledge')
  const files = page.getByTestId('extensions-group-file')
  await expect(knowledge.getByRole('heading', { name: 'Knowledge' })).toBeVisible()
  await expect(files.getByRole('heading', { name: 'Files' })).toBeVisible()
  await expect(page.getByTestId('extensions-group-annotate')).toHaveCount(0)

  // card/note/area/table land in Knowledge; image/diagram/sheet in
  // Files (image/diagram/sheet are the file-backed family).
  for (const id of ['card', 'note', 'area', 'table']) {
    await expect(knowledge.locator(`[data-testid="extensions-row"][data-extension-id="${id}"]`)).toBeVisible()
  }
  for (const id of ['image', 'diagram', 'sheet']) {
    await expect(files.locator(`[data-testid="extensions-row"][data-extension-id="${id}"]`)).toBeVisible()
  }

  // The drawing tools surface as the bundled Drawing plugin's ONE row.
  const drawingPlugin = page.locator('[data-testid="extensions-plugin-row"][data-plugin-id="mill-drawing"]')
  await expect(drawingPlugin).toBeVisible()
  await expect(drawingPlugin.getByText('Built into Mill')).toBeVisible()

  // Every row's own title is the bare noun, one word.
  const expectedTitles: Record<string, string> = {
    card: 'Card', note: 'Note', area: 'Area', table: 'Table', image: 'Image',
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
  for (const id of ['note', 'area', 'table', 'image', 'diagram', 'sheet']) {
    const toggle = page.locator(`[data-testid="extensions-row"][data-extension-id="${id}"]`).getByTestId('extensions-row-toggle').getByRole('button')
    await expect(toggle).toHaveAttribute('data-checked', 'false')
  }

  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  for (const id of ['note', 'area', 'table', 'image']) {
    await expect(page.getByTestId(`atlas-tray-${id}`)).toHaveCount(0)
  }
  // card is the kernel object, never affected by the bulk toggle.
  await expect(page.getByTestId('atlas-tray-card')).toBeVisible()
  // The Drawing plugin's tools ride the PLUGIN's own toggle (its row
  // in Installed plugins), never the compiled-in bulk toggle -- the
  // annotate drawer stays.
  await expect(page.getByTestId('atlas-tray-annotate-group')).toBeVisible()

  // Restore -- shared-pool cleanup discipline.
  await page.getByRole('link', { name: 'Settings' }).click()
  await openExtensionsSection(page)
  await expect(toggleAll).toHaveText('Turn all on')
  await toggleAll.click()
  await expect(toggleAll).toHaveText('Turn all off')
  for (const id of ['note', 'area', 'table', 'image', 'diagram', 'sheet']) {
    const toggle = page.locator(`[data-testid="extensions-row"][data-extension-id="${id}"]`).getByTestId('extensions-row-toggle').getByRole('button')
    await expect(toggle).toHaveAttribute('data-checked', 'true')
  }
})

test('Extensions section lists every registered canvas tool; the built-in card row has no toggle', async ({ page }) => {
  await page.goto('/')
  await openExtensionsSection(page)

  // Every compiled-in ATLAS_TOOLS member (atlas/atlasTools.ts) plus
  // every tool-less noun (diagram, sheet) gets exactly one row --
  // card, note, area, table, image, diagram, sheet. The drawing tools
  // are the Drawing plugin's row, not four rows here (goal 0252).
  await expect(page.getByTestId('extensions-row')).toHaveCount(7)

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

test('Disabling the Drawing plugin removes its tray tools and palette commands after reload, keeps existing objects on the board, and re-enabling restores everything', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  // A shape placed BEFORE the plugin is disabled -- proves disabling
  // never deletes already-created objects (goal 0252 acceptance).
  await clickAtlasTrayTool(page, 'atlas-tray-shape')
  const picker = page.getByTestId('atlas-shape-style-picker')
  await expect(picker).toBeVisible()
  const draw = await shapeDrawPoints(page, board, picker)
  await dragBetween(page, draw.from, draw.to)
  const shapes = shapeObjects(page)
  await expect(shapes).toHaveCount(1)

  // Disable the Drawing plugin from its own installed-plugins row.
  await openExtensionsSection(page)
  const drawingRow = page.locator('[data-testid="extensions-plugin-row"][data-plugin-id="mill-drawing"]')
  const drawingToggle = drawingRow.getByTestId('extensions-plugin-toggle').getByRole('button')
  await expect(drawingToggle).toHaveAttribute('data-checked', 'true')
  await drawingToggle.click()
  await expect(drawingToggle).toHaveAttribute('data-checked', 'false')

  // Plugins load at app start (the standing plugin contract), so the
  // change takes effect on reload.
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(board).toBeVisible()
  for (const id of ['pencil', 'eraser', 'laser', 'shape']) {
    await expect(page.getByTestId(`atlas-tray-${id}`)).toHaveCount(0)
  }
  // With every annotate tool gone, the drawer trigger has nothing to
  // disclose.
  await expect(page.getByTestId('atlas-tray-annotate-group')).toHaveCount(0)

  // The object placed earlier is still ON the board -- visible,
  // selectable, deletable (the unknown-kind fallback face), never
  // silently dropped.
  await expect(shapes).toHaveCount(1)

  // Palette: the plugin's creation commands are gone too (Cmd+/ opens
  // the global palette even on the atlas surface).
  await page.keyboard.press('Meta+/')
  await expect(paletteDialog(page)).toBeVisible()
  await paletteDialog(page).getByRole('combobox').fill('Draw a shape')
  await expect(paletteDialog(page).getByRole('option', { name: 'Draw a shape' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // Cleanup: re-enable the plugin, reload, delete the object.
  await openExtensionsSection(page)
  const toggleAfter = page.locator('[data-testid="extensions-plugin-row"][data-plugin-id="mill-drawing"]').getByTestId('extensions-plugin-toggle').getByRole('button')
  await expect(toggleAfter).toHaveAttribute('data-checked', 'false')
  await toggleAfter.click()
  await expect(toggleAfter).toHaveAttribute('data-checked', 'true')
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(board).toBeVisible()
  await page.getByTestId('atlas-tray-annotate-group').click()
  await expect(page.getByTestId('atlas-tray-shape')).toBeVisible()
  await page.keyboard.press('Escape')
  await deleteViaContextMenu(page, shapeObjects(page).first())
  await expect(shapeObjects(page)).toHaveCount(0)
})
