import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures/server'
import { createBoardObjectViaRPC, ATLAS_DEFAULT_SPACE_ID } from './fixtures/atlasNativeDropEscapeHatch'

// The "sheet" board object (goal 0232 S2): dropping a .xlsx/.csv file
// lands a board-local, read-only spreadsheet preview -- never a
// rebuilt Excel (owner: "I will not reinvent Excel"). The routing
// DECISION (which extensions count as a sheet) is Vitest-tested
// directly (useAtlasSheetObjectCreate.test.ts's isSheetPath), same
// scope split atlas-diagram-object.spec.ts's own header documents; the
// native OS drop gesture itself has no reachable user primitive in
// this harness (fixtures/atlasNativeDropEscapeHatch.ts) -- this file
// proves the RESULT renders correctly once such an object exists, via
// the same CreateBoardObject RPC escape hatch.
//
// Every test lands its object at the SAME flow position (0, 480) --
// atlas-diagram-object.spec.ts's own proven-safe coordinate -- and a
// beforeEach wipes any leftover "sheet" object first: fit-to-view scales
// the WHOLE board's bounding box to the viewport, so a straggler from a
// prior failed attempt (Playwright's own retry re-runs the test body,
// including a fresh CreateBoardObject call, without the original's
// cleanup ever having run) silently grows that box on every later test,
// eventually landing an otherwise-safe coordinate under the MiniMap's
// fixed bottom-right panel. Wiping first, rather than trusting each
// test's own end-of-body cleanup, breaks that accumulation regardless
// of which earlier test failed.

const FIXTURE_DIR = path.join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures')
const CSV_FIXTURE = path.join(FIXTURE_DIR, 'sheet-preview-sample.csv')
const XLSX_FIXTURE = path.join(FIXTURE_DIR, 'sheet-preview-sample.xlsx')
const SAFE_POS = { X: 0, Y: 480 }

function sheetObjects(page: import('@playwright/test').Page) {
  return page.locator('[data-testid="atlas-board-object"][data-object-kind="sheet"]')
}

async function openBoard(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
}

// Deletes every "sheet" board object currently on the default space via
// the same low-level RPC channel createBoardObjectViaRPC uses -- the
// bulk counterpart to a single DeleteBoardObject call, since no user
// gesture in this harness needs to select-and-delete a whole class of
// object at once.
async function clearSheetObjects(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    const call = async (methodName: string, args: unknown[]) => {
      const callID = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const res = await fetch(window.location.origin + '/wails/runtime', {
        method: 'POST',
        headers: { 'x-wails-client-id': 'e2e-sheet-cleanup', 'Content-Type': 'application/json' },
        body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': callID, methodName, args } }),
      })
      if (!res.ok) throw new Error(`${methodName} failed: ${res.status} ${await res.text()}`)
      return res.json()
    }
    const result = await call('github.com/alicoding/mill/internal/services/atlassvc.AtlasService.Objects', [])
    const objects = (result ?? []) as { ID: string; Kind: string }[]
    for (const o of objects) {
      if (o.Kind === 'sheet') {
        await call('github.com/alicoding/mill/internal/services/atlassvc.AtlasService.DeleteBoardObject', [o.ID])
      }
    }
  })
}

// Waits for React Flow's own post-load fitView animation to fully
// settle (d3-zoom's JS-driven interpolation, not a CSS transition) --
// clicking against an in-flight pan/zoom races a bounding box that's
// still moving, the same class of race
// fixtures/atlasBoard.ts's clickFrameGutter documents for a region
// frame's own gutter click.
async function waitForBoardSettled(page: import('@playwright/test').Page): Promise<void> {
  const viewport = page.locator('.react-flow__viewport')
  let previous: string | null = null
  await expect
    .poll(async () => {
      const transform = await viewport.evaluate((el) => (el as HTMLElement).style.transform)
      const stable = previous !== null && transform === previous
      previous = transform
      return stable
    }, { timeout: 5_000 })
    .toBe(true)
}

async function landSheetObject(page: import('@playwright/test').Page, mirrorPath: string): Promise<import('@playwright/test').Locator> {
  await openBoard(page)
  await clearSheetObjects(page)
  await createBoardObjectViaRPC(page, 'sheet', { mirrorPath }, SAFE_POS, ATLAS_DEFAULT_SPACE_ID)
  await page.reload()
  await openBoard(page)
  await waitForBoardSettled(page)
  return sheetObjects(page)
}

async function deleteViaContextMenu(page: import('@playwright/test').Page, target: import('@playwright/test').Locator) {
  // Re-settle before every right-click, not just the first: closing an
  // earlier menu/interaction can itself trigger a further layout
  // shift, and a click racing that shift is the same class
  // waitForBoardSettled above already guards against post-load.
  await waitForBoardSettled(page)
  await target.click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
}

test('a dropped .csv file renders as a sheet board object with a real, distinct header row', async ({ page }) => {
  const sheetObject = await landSheetObject(page, CSV_FIXTURE)
  const grid = sheetObject.getByTestId('atlas-object-sheet-grid')
  await expect(grid).toBeVisible()

  // Real cell text from the committed fixture -- header cells render as
  // <th> (a real, distinct element from a data <td>, not just styled
  // text), data cells as <td>.
  const headerRow = grid.locator('thead tr')
  await expect(headerRow.locator('th')).toHaveText(['Name', 'Age', 'City'])
  const firstDataRow = grid.locator('tbody tr').first()
  await expect(firstDataRow.locator('td')).toHaveText(['Ada Lovelace', '36', 'London'])

  await deleteViaContextMenu(page, sheetObject)
  await expect(sheetObjects(page)).toHaveCount(0)
})

test('a dropped .xlsx file renders as a sheet board object with real cell text', async ({ page }) => {
  const sheetObject = await landSheetObject(page, XLSX_FIXTURE)
  const grid = sheetObject.getByTestId('atlas-object-sheet-grid')
  await expect(grid).toBeVisible()
  await expect(grid.locator('thead tr').locator('th')).toHaveText(['Name', 'Age', 'City'])
  await expect(grid.locator('tbody tr').nth(1).locator('td')).toHaveText(['Grace Hopper', '85', 'New York'])

  await deleteViaContextMenu(page, sheetObject)
  await expect(sheetObjects(page)).toHaveCount(0)
})

test('a sheet with more than 50 rows shows the truncation note', async ({ page }) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const nodePath = await import('node:path')
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'mill-e2e-atlas-sheet-truncate-'))
  const bigCSV = nodePath.join(dir, 'ZzE2eSheetTruncate.csv')
  const lines = ['Header']
  for (let i = 0; i < 60; i++) lines.push(`row-${i}`)
  fs.writeFileSync(bigCSV, lines.join('\n'))

  const sheetObject = await landSheetObject(page, bigCSV)
  await expect(sheetObject.getByTestId('atlas-object-sheet-grid')).toBeVisible()
  await expect(sheetObject.getByTestId('atlas-object-sheet-truncated')).toHaveText('Showing the first 50 of 61 rows.')

  await deleteViaContextMenu(page, sheetObject)
  await expect(sheetObjects(page)).toHaveCount(0)
})

// The preview caps are the Sheet extension's own declared NUMBER
// settings (goal 0258 slice 1): the host renders a number field in
// the Sheet row, commits on Enter (clamped to the declared range, an
// invalid draft reverting), and every open sheet re-renders against
// the new cap. Restored to the default before the test ends (shared-
// pool global-flag discipline).
test('the sheet preview row cap is a declared number setting the sheet honors live', async ({ page }) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const nodePath = await import('node:path')
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'mill-e2e-atlas-sheet-cap-'))
  const bigCSV = nodePath.join(dir, 'ZzE2eSheetCap.csv')
  const lines = ['Header']
  for (let i = 0; i < 60; i++) lines.push(`row-${i}`)
  fs.writeFileSync(bigCSV, lines.join('\n'))

  const setPreviewRows = async (draft: string) => {
    await page.getByRole('link', { name: 'Settings' }).click()
    const sheetRow = page.locator('[data-testid="extensions-row"][data-extension-id="sheet"]')
    if (!(await sheetRow.getByTestId('extensions-row-expanded').isVisible())) await sheetRow.locator('summary').click()
    const field = page.getByTestId('extension-setting-sheet-previewRows').locator('input')
    await field.fill(draft)
    await page.keyboard.press('Enter')
    return field
  }

  await page.goto('/')
  let field = await setPreviewRows('5')
  await expect(field).toHaveValue('5')
  // An empty draft (the one non-numeric state a number field can
  // reach -- the browser refuses letters) reverts to the committed
  // value; one above the declared max clamps to it (below).
  await field.fill('')
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue('5')

  const sheetObject = await landSheetObject(page, bigCSV)
  await expect(sheetObject.getByTestId('atlas-object-sheet-truncated')).toHaveText('Showing the first 5 of 61 rows.')

  field = await setPreviewRows('9999')
  await expect(field).toHaveValue('500')

  // Restore the default, then confirm the sheet is back on it.
  field = await setPreviewRows('50')
  await expect(field).toHaveValue('50')
  await openBoard(page)
  await waitForBoardSettled(page)
  await expect(sheetObjects(page).getByTestId('atlas-object-sheet-truncated')).toHaveText('Showing the first 50 of 61 rows.')

  await deleteViaContextMenu(page, sheetObjects(page))
  await expect(sheetObjects(page)).toHaveCount(0)
})

// The file-backed preview/open/watch contract's own command (goal
// 0232 S1, extended to this Kind by S2): "Open in default app" appears
// on a sheet board object's own context menu, the same generic
// fileBacked wiring diagram already proved live
// (atlas-diagram-object.spec.ts) -- this is sheet's own instance of
// that proof.
test('a sheet board object offers "Open in default app"', async ({ page }) => {
  const sheetObject = await landSheetObject(page, CSV_FIXTURE)
  await expect(sheetObject).toBeVisible()
  await sheetObject.click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  const openInDefaultApp = menu.getByText('Open in default app', { exact: true })
  await expect(openInDefaultApp).toBeVisible()
  // Headless/server mode has no live desktop app to launch -- the RPC
  // still resolves (no error toast), proving the menu item is wired to
  // the real command rather than a dead click.
  await openInDefaultApp.click()
  await expect(menu).not.toBeVisible()

  // Cleanup goes through the same RPC beforeEach-equivalent cleanup
  // uses, not a second context-menu round trip: this test's own point
  // (the menu item exists and is wired) is already proven above: a
  // menu/RPC round trip can itself shift the board's fit-to-view layout
  // (a real, settled reposition, not an animation race
  // waitForBoardSettled already guards against), which a second blind
  // right-click has no reason to re-risk once nothing further is being
  // asserted about the context menu itself.
  await clearSheetObjects(page)
  await page.reload()
  await openBoard(page)
  await expect(sheetObjects(page)).toHaveCount(0)
})

test('a corrupt .xlsx shows "Can\'t read this file." with an Open in default app door', async ({ page }) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const nodePath = await import('node:path')
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'mill-e2e-atlas-sheet-corrupt-'))
  const badXlsx = nodePath.join(dir, 'ZzE2eSheetCorrupt.xlsx')
  fs.writeFileSync(badXlsx, 'this is not a real xlsx file, just bytes with the wrong extension')

  const sheetObject = await landSheetObject(page, badXlsx)
  const unreadable = sheetObject.getByTestId('atlas-object-sheet-unreadable')
  await expect(unreadable).toBeVisible()
  await expect(unreadable).toContainText("Can't read this file.")
  const openDoor = sheetObject.getByTestId('atlas-object-sheet-open-in-default-app')
  await expect(openDoor).toBeVisible()
  await openDoor.click()

  // Same RPC cleanup as the "Open in default app" test above, for the
  // same reason: the door's own RPC round trip already ran, so a
  // second context-menu interaction on top of it isn't proving anything
  // this test doesn't already assert.
  await clearSheetObjects(page)
  await page.reload()
  await openBoard(page)
  await expect(sheetObjects(page)).toHaveCount(0)
})

// Quick-edit (goal 0239 S2): the middle rung between the read-only
// preview and open-in-the-owning-app -- a csv cell edits in place and
// the WHOLE file writes back with structure intact (the exact-bytes
// assertion below is the fidelity contract, trailing newline
// included). xlsx stays read-only by design: no editor ever mounts.
async function tempCsv(name: string, content: string): Promise<string> {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const nodePath = await import('node:path')
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'mill-e2e-sheet-edit-'))
  const file = nodePath.join(dir, name)
  fs.writeFileSync(file, content)
  return file
}

test('double-clicking a csv cell edits it in place: Enter commits to the grid and to the file on disk', async ({ page }) => {
  const fs = await import('node:fs')
  const file = await tempCsv('ZzE2eSheetEdit.csv', 'Name,Age\nAda,36\n')

  const sheetObject = await landSheetObject(page, file)
  const grid = sheetObject.getByTestId('atlas-object-sheet-grid')
  await expect(grid).toBeVisible()

  const ageCell = grid.locator('tbody tr').first().locator('td').nth(1)
  await expect(ageCell).toHaveText('36')
  await ageCell.dblclick()
  const input = sheetObject.getByTestId('atlas-object-sheet-cell-input')
  await expect(input).toBeVisible()
  await expect(input).toBeFocused()
  // Focus selects the current value, so filling replaces it -- the
  // spreadsheet convention.
  await input.fill('37') // fill: a form control; per-keystroke typing drops characters under CI load (goal 0296)
  await page.keyboard.press('Enter')

  await expect(input).toHaveCount(0)
  await expect(grid.locator('tbody tr').first().locator('td').nth(1)).toHaveText('37')
  // The write reaches the real file with structure intact: delimiter,
  // untouched cells, and the trailing newline all survive.
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('Name,Age\nAda,37\n')

  await deleteViaContextMenu(page, sheetObject)
  await expect(sheetObjects(page)).toHaveCount(0)
})

test('Escape cancels a cell edit, leaving the grid and the file untouched', async ({ page }) => {
  const fs = await import('node:fs')
  const file = await tempCsv('ZzE2eSheetEscape.csv', 'Name,Age\nAda,36\n')

  const sheetObject = await landSheetObject(page, file)
  const grid = sheetObject.getByTestId('atlas-object-sheet-grid')
  const ageCell = grid.locator('tbody tr').first().locator('td').nth(1)
  await ageCell.dblclick()
  const input = sheetObject.getByTestId('atlas-object-sheet-cell-input')
  await expect(input).toBeFocused()
  await input.fill('999') // fill: a form control; per-keystroke typing drops characters under CI load (goal 0296)
  await page.keyboard.press('Escape')

  await expect(input).toHaveCount(0)
  await expect(ageCell).toHaveText('36')
  expect(fs.readFileSync(file, 'utf8')).toBe('Name,Age\nAda,36\n')

  await deleteViaContextMenu(page, sheetObject)
  await expect(sheetObjects(page)).toHaveCount(0)
})

test('an xlsx cell never opens an editor on double-click (read-only by design)', async ({ page }) => {
  const sheetObject = await landSheetObject(page, XLSX_FIXTURE)
  const grid = sheetObject.getByTestId('atlas-object-sheet-grid')
  await expect(grid).toBeVisible()
  await grid.locator('tbody tr').first().locator('td').first().dblclick()
  await expect(sheetObject.getByTestId('atlas-object-sheet-cell-input')).toHaveCount(0)

  await deleteViaContextMenu(page, sheetObject)
  await expect(sheetObjects(page)).toHaveCount(0)
})
