import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test, expect } from './fixtures/server'
import { createBoardObjectViaRPC, ATLAS_DEFAULT_SPACE_ID } from './fixtures/atlasNativeDropEscapeHatch'

// Shared worker pool (testing.md): every assertion below is scoped to
// the one diagram object each test creates and cleans up itself --
// nothing here reads global app state another test could have written.

// goal 0194's live round-trip slice: AtlasService watches a diagram
// board object's own mirrorPath on disk (internal/adapters/filewatch)
// and fires the "atlas-mirror-changed" dataevent on a debounced write,
// so the rendered face refetches without any user action. Complements
// atlas-diagram-object.spec.ts (which proves the object's initial
// render); this file proves the file→event→refetch loop and the
// honest "file's gone" state a vanished mirror renders instead of a
// stale or blank view.

function diagramObjects(page: import('@playwright/test').Page) {
  return page.locator('[data-testid="atlas-board-object"][data-object-kind="diagram"]')
}

function makeDrawioXML(label: string): string {
  return `<mxfile host="mill-e2e"><diagram id="page1" name="Page-1"><mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="${label}" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="120" y="120" width="160" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`
}

async function cleanUpObject(page: import('@playwright/test').Page, object: import('@playwright/test').Locator): Promise<void> {
  await object.click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(object).not.toBeVisible()
}

test('a diagram board object re-renders live when its mirrored file changes on disk', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-atlas-live-mirror-'))
  const file = path.join(dir, 'ZzE2eLiveMirror.drawio')
  fs.writeFileSync(file, makeDrawioXML('Original'))

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // X well clear of the creation tray, which is absolutely positioned
  // horizontally centered near the viewport bottom (AtlasCreationTray.
  // module.css) -- a centered object's own controls can render behind it.
  await createBoardObjectViaRPC(page, 'diagram', { mirrorPath: file }, { X: -700, Y: 480 }, ATLAS_DEFAULT_SPACE_ID)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()

  const object = diagramObjects(page)
  await expect(object).toBeVisible()
  await expect(object.locator('svg')).toContainText('Original')

  // The external edit an editor/CLI would make -- no reload, no click.
  fs.writeFileSync(file, makeDrawioXML('Updated'))

  // fsnotify + the ~500ms debounce mean this is genuinely timing-bound,
  // not instant -- expect's own polling absorbs that, no waitForTimeout.
  await expect(object.locator('svg')).toContainText('Updated', { timeout: 10000 })

  await cleanUpObject(page, object)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a vanished mirror file renders an honest state instead of a stale or blank view', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-atlas-live-mirror-missing-'))
  const file = path.join(dir, 'ZzE2eMissingMirror.drawio')
  fs.writeFileSync(file, makeDrawioXML('Here'))

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await createBoardObjectViaRPC(page, 'diagram', { mirrorPath: file }, { X: -700, Y: 480 }, ATLAS_DEFAULT_SPACE_ID)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()

  const object = diagramObjects(page)
  await expect(object).toBeVisible()
  await expect(object.locator('svg')).toContainText('Here')

  fs.rmSync(file)

  const missing = object.getByTestId('atlas-object-diagram-missing')
  await expect(missing).toBeVisible({ timeout: 10000 })
  await expect(object.getByTestId('atlas-object-diagram-choose-file')).toBeVisible()
  // Never a stale render of the last-known content.
  await expect(object.locator('svg')).not.toBeVisible()

  // "Choose file" re-points the mirror -- MILL_TEST_DIAGRAM_PICK_PATH
  // (fixtures/server.ts) stands in for the native OS dialog server-mode
  // Playwright has no display for, returning fixtures/diagram-pick.drawio
  // (label "Replacement") every time it's invoked.
  await object.getByTestId('atlas-object-diagram-choose-file').click()
  await expect(object.locator('svg')).toContainText('Replacement', { timeout: 10000 })

  await cleanUpObject(page, object)
  fs.rmSync(dir, { recursive: true, force: true })
})
