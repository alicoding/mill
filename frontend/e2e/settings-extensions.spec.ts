import { test, expect } from './fixtures/server'
import { dragBetween } from './fixtures/atlasBoard'
import { clickAtlasTrayTool } from './fixtures/atlasTray'
import { placeNoteClear } from './fixtures/atlasEmptyRegion'
import { deleteViaContextMenu, shapeDrawPoints, shapeObjects } from './fixtures/atlasShapeTool'
import { paletteDialog } from './fixtures/palette'
import { builtInRows, extensionRow, openExtensionDetail, openExtensions, openSettings, pluginRow } from './fixtures/settingsNav'

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
  await openExtensions(page)
  await expect(page.getByTestId('extensions-list')).toBeVisible()
}

test('A row carries no settings; clicking it opens the detail pane, and Escape returns focus to the row', async ({ page }) => {
  await page.goto('/')
  await openExtensionsSection(page)

  const imageRow = extensionRow(page, 'image')
  // The row's own title is the bare noun, never the tray/palette's own
  // command-verb phrase ("Add an image").
  await expect(imageRow.getByTestId('extensions-row-title')).toHaveText('Image')
  // Identity only: nothing unfolds inside a row any more.
  await expect(page.getByTestId('extensions-detail')).toHaveCount(0)
  await expect(imageRow.getByTestId('extensions-row-expanded')).toHaveCount(0)

  const detail = await openExtensionDetail(page, imageRow, 'image')
  await expect(detail.getByTestId('extensions-detail-description')).toHaveText('Adds an image from your files or the clipboard.')
  await expect(detail.getByTestId('extensions-detail-reach')).toHaveText('Reaches nothing outside Mill.')
  await expect(detail.getByTestId('extensions-detail-provenance')).toHaveText(/^Ships with Mill v/)
  await expect(detail.getByText('Media', { exact: true })).toBeVisible()
  await expect(detail.getByTestId('extensions-detail-adds')).toContainText('Commands: Add an image')
  await expect(detail.getByTestId('extensions-detail-adds')).toContainText('Canvas objects: Image')

  // Escape closes the pane and puts focus back on the row that opened
  // it -- a keyboard user is never left behind in the list.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('extensions-detail')).toHaveCount(0)
  await expect(imageRow.getByTestId('extensions-row-open')).toBeFocused()
})

test('The Sheet row opens a detail pane carrying its declared setting', async ({ page }) => {
  await page.goto('/')
  await openExtensionsSection(page)

  const detail = await openExtensionDetail(page, extensionRow(page, 'sheet'), 'sheet')
  const control = detail.getByTestId('extension-setting-sheet-previewRows')
  await expect(control).toBeVisible()
  await expect(control).toContainText('Preview rows')
  // And it is NOT on the row -- the whole point of the pane.
  await expect(extensionRow(page, 'sheet').getByTestId('extension-setting-sheet-previewRows')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('extensions-detail')).toHaveCount(0)
})

test('Compact density makes every Extensions row shorter', async ({ page }) => {
  await page.goto('/')
  await openExtensionsSection(page)
  const row = extensionRow(page, 'note')
  const heightOf = () => row.evaluate((el) => el.getBoundingClientRect().height)

  const comfortable = await heightOf()
  await openSettings(page, 'appearance')
  await page.getByTestId('density-control').getByRole('button', { name: 'Compact' }).click()
  await openExtensionsSection(page)
  await expect.poll(heightOf).toBeLessThan(comfortable)

  // Restore -- shared-pool cleanup discipline (density is a global flag).
  await openSettings(page, 'appearance')
  await page.getByTestId('density-control').getByRole('button', { name: 'Comfortable' }).click()
  await openExtensionsSection(page)
  await expect.poll(heightOf).toBe(comfortable)
})

test('The list groups into sections; every row title is a noun, and the drawing tools live in the plugin row instead', async ({ page }) => {
  await page.goto('/')
  await openExtensionsSection(page)

  // Two sections, registry-derived, in the same objects/media order the
  // creation dock renders (goal 0355). The Drawing section is GONE
  // (goal 0252): with the freehand tools demoted into the Drawing
  // plugin no compiled-in noun declares group 'annotate', and an empty
  // group hides rather than rendering a heading over nothing.
  const objects = page.getByTestId('extensions-group-objects')
  const media = page.getByTestId('extensions-group-media')
  await expect(objects.getByText('Objects', { exact: true })).toBeVisible()
  await expect(media.getByText('Media', { exact: true })).toBeVisible()
  await expect(page.getByTestId('extensions-group-annotate')).toHaveCount(0)
  await expect(page.getByTestId('extensions-group-embed')).toHaveCount(0)

  // card/note/area/table land in Objects; image/diagram/sheet in Media
  // (image/diagram/sheet are the file-backed family).
  for (const id of ['card', 'note', 'area', 'table']) {
    await expect(objects.locator(`[data-testid="extensions-row"][data-extension-id="${id}"]`)).toBeVisible()
  }
  for (const id of ['image', 'diagram', 'sheet']) {
    await expect(media.locator(`[data-testid="extensions-row"][data-extension-id="${id}"]`)).toBeVisible()
  }

  // The drawing tools surface as the bundled Drawing plugin's ONE row.
  const drawingPlugin = pluginRow(page, 'mill-drawing')
  await expect(drawingPlugin).toBeVisible()
  // Where it came from reads in its detail pane, not on the row -- and
  // exactly once: a bundled plugin says so on the header's meta line,
  // so it gets no second provenance line under it.
  const drawingDetail = await openExtensionDetail(page, drawingPlugin, 'mill-drawing')
  await expect(drawingDetail.getByTestId('extensions-detail-meta')).toContainText('Built into Mill')
  await expect(drawingDetail.getByTestId('extensions-detail-provenance')).toHaveCount(0)
  await expect(drawingDetail.getByText('Built into Mill')).toHaveCount(1)
  await page.keyboard.press('Escape')

  // Every row's own title is the bare noun, one word.
  const expectedTitles: Record<string, string> = {
    card: 'Card', note: 'Note', area: 'Area', table: 'Table', image: 'Image',
    diagram: 'Diagram', sheet: 'Sheet',
  }
  for (const [id, title] of Object.entries(expectedTitles)) {
    const row = page.locator(`[data-testid="extensions-row"][data-extension-id="${id}"]`)
    await expect(row.getByTestId('extensions-row-title')).toHaveText(title)
  }

  // A row's second half is ONE line of description (goal 0321) -- the
  // source/edit-route facts moved into the detail pane.
  await expect(extensionRow(page, 'image').getByTestId('extensions-row-description'))
    .toHaveText('Adds an image from your files or the clipboard.')
  await expect(extensionRow(page, 'image').getByTestId('extensions-row-meta')).toHaveCount(0)
})

test('A row stays one line at 1000px viewport width, however long its description', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 660 })
  await page.goto('/')
  await openExtensionsSection(page)

  // diagram's description is the longest in the list -- the stress
  // case for wrapping. It ellipsizes rather than wrapping the row.
  const row = extensionRow(page, 'diagram')
  await expect(row).toBeVisible()
  const box = await row.boundingBox()
  if (!box) throw new Error('the diagram row has no bounding box')
  // A Comfortable row is 44px by construction (extensionMeta.ts's
  // extensionRowHeight); two wrapped lines would exceed 60.
  expect(box.height).toBeLessThan(60)
})

test('The toggle knob stays contained within its own row, even scrolled far down the list', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 660 })
  await page.goto('/')
  await openExtensionsSection(page)

  // Regression: a ToggleSwitch knob's own compositor layer painted
  // OUTSIDE its row entirely once the settings pane was scrolled, and
  // hit-tested over whatever sat at the top of the pane.
  const sheetRow = extensionRow(page, 'sheet')
  await sheetRow.scrollIntoViewIfNeeded()
  const knob = sheetRow.getByTestId('extensions-row-toggle')
  const rowBox = await sheetRow.boundingBox()
  const knobBox = await knob.boundingBox()
  if (!rowBox || !knobBox) throw new Error('the sheet row or its toggle has no bounding box')
  expect(knobBox.y).toBeGreaterThanOrEqual(rowBox.y - 1)
  expect(knobBox.y + knobBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 1)
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

  // The inventory is asserted as a SET of ids, not as a number: the
  // registry behind it (atlas/atlasTools.ts) is built with Vite's
  // import.meta.glob, so a spec running in Node has no door to read it
  // back through, and a bare count would drift into a mystery number
  // on the next noun. Named ids fail with the noun that appeared or
  // vanished, which is the thing a reader needs.
  //
  // Every compiled-in ATLAS_TOOLS member plus every tool-less noun
  // (diagram, sheet, pdf, json -- goals 0267, 0269) gets exactly one
  // row. The drawing tools are the Drawing plugin's row, not four rows
  // here (goal 0252).
  const BUILT_IN_EXTENSION_IDS = ['card', 'note', 'area', 'table', 'image', 'diagram', 'sheet', 'pdf', 'json']
  await expect(builtInRows(page)).toHaveCount(BUILT_IN_EXTENSION_IDS.length)
  const renderedIDs = await builtInRows(page).evaluateAll((rows) => rows.map((r) => r.getAttribute('data-extension-id')))
  expect(renderedIDs.slice().sort()).toEqual(BUILT_IN_EXTENSION_IDS.slice().sort())

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

  const diagramRow = extensionRow(page, 'diagram')
  await expect(diagramRow.getByTestId('extensions-row-toggle').getByRole('button')).toHaveAttribute('data-checked', 'true')
  const diagram = await openExtensionDetail(page, diagramRow, 'diagram')
  await expect(diagram.getByTestId('extensions-detail-description')).toHaveText(
    'View and edit diagrams. draw.io files open in the real editor.',
  )
  await expect(diagram.getByTestId('extensions-detail-disable-scope')).toHaveText(
    'Turning this off stops new diagrams from landing on drop and closes the built-in editor. Diagrams already on the board keep working.',
  )

  const sheetRow = extensionRow(page, 'sheet')
  await expect(sheetRow.getByTestId('extensions-row-toggle').getByRole('button')).toHaveAttribute('data-checked', 'true')
  const sheet = await openExtensionDetail(page, sheetRow, 'sheet')
  await expect(sheet.getByTestId('extensions-detail-description')).toHaveText(
    'Preview spreadsheets and CSV files dropped onto the board.',
  )
  await expect(sheet.getByTestId('extensions-detail-disable-scope')).toHaveText(
    'Turning this off stops new sheets from landing on drop. Sheets already on the board keep working, including opening in your default app.',
  )

  // A tray tool's pane never shows a disable-scope note -- its
  // toggle's scope (tray button + palette command) is already the
  // standing default every extension implicitly shares.
  const table = await openExtensionDetail(page, extensionRow(page, 'table'), 'table')
  await expect(table.getByTestId('extensions-detail-disable-scope')).toHaveCount(0)
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
  const drawingRow = pluginRow(page, 'mill-drawing')
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
  const toggleAfter = pluginRow(page, 'mill-drawing').getByTestId('extensions-plugin-toggle').getByRole('button')
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

// A declared extension setting (goal 0258 S1): the note's DETAIL pane
// renders its declared "Rich code blocks" control generically, the
// value persists through the central settings blob, and the note
// editor honors it -- a code fence renders the engine's CodeMirror
// block only while the setting is on. Cleanup restores the default
// (off) before the file ends, per this spec's own global-flag rule.
test('The note pane offers its declared Rich code blocks setting, and the note editor honors it', async ({ page }) => {
  await page.goto('/')
  await openExtensionsSection(page)
  await openExtensionDetail(page, extensionRow(page, 'note'), 'note')
  const settingControl = page.getByTestId('extension-setting-note-richCodeBlocks')
  await expect(settingControl).toBeVisible()
  await expect(settingControl).toContainText('Rich code blocks')
  const checkbox = settingControl.locator('input[type="checkbox"]')
  await expect(checkbox).not.toBeChecked()
  await checkbox.check()
  await expect(checkbox).toBeChecked()

  // The editor honors it on the next mount: a note with a code fence
  // renders CodeMirror's own editor block.
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await placeNoteClear(page, board)
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('contenteditable') === 'true'))
    .toBe(true)
  await page.keyboard.type('```js', { delay: 30 })
  await page.keyboard.press('Enter')
  // The fence converts to the CodeMirror block async, and the block's
  // node view can be REBUILT once more when the first content sync
  // lands (the adopted editor's own timing) -- per-keystroke typing
  // into that window drops characters nondeterministically, and no DOM
  // signal marks the rebuild settled. Escape hatch (testing.md): the
  // content lands as ONE atomic insertText, which survives the rebuild
  // the way already-committed doc content does; the format assertion
  // below still exercises the real keybinding as a user primitive.
  const sticky = page.getByTestId('atlas-sticky-note')
  await expect(sticky.locator('.cm-content')).toHaveAttribute('data-language', 'javascript')
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('.cm-editor')))
    .toBe(true)
  await page.keyboard.insertText('const  x=1')
  await expect(sticky.locator('.cm-editor .cm-content')).toContainText('const  x=1')

  // Shift-Alt-F formats the block via prettier (goal 0268) -- the
  // converged format keybinding, mounted through the code-block
  // feature's own CodeMirror extensions seam. Mangled spacing
  // normalizes in place.
  await sticky.locator('.cm-editor .cm-content').click()
  await page.keyboard.press('Shift+Alt+f')
  // Generous timeout: the FIRST format cold-loads the prettier
  // chunk (dynamic import), which under parallel-worker contention
  // can exceed the default 5s.
  await expect(sticky.locator('.cm-editor .cm-content')).toContainText('const x = 1;', { timeout: 15_000 })

  // Turn the setting back off; a FRESH edit session drops CodeMirror.
  await openExtensionsSection(page)
  await openExtensionDetail(page, extensionRow(page, 'note'), 'note')
  await checkbox.uncheck()
  await expect(checkbox).not.toBeChecked()
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(board).toBeVisible()
  await sticky.dblclick()
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('contenteditable') === 'true'))
    .toBe(true)
  await expect(sticky.locator('.cm-editor')).toHaveCount(0)

  // Cleanup: the note itself.
  await page.keyboard.press('Escape')
  await sticky.click()
  await page.keyboard.press('Delete')
  await expect(sticky).toHaveCount(0)
})
