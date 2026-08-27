import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test, expect } from './fixtures/server'
import { createBoardObjectViaRPC, ATLAS_DEFAULT_SPACE_ID } from './fixtures/atlasNativeDropEscapeHatch'
import { nonSeededBoardObjects } from './fixtures/atlasBoard'

// Shared worker pool (testing.md): every assertion below is scoped to
// the one diagram object each test creates and cleans up itself.
//
// goal 0237 S1: the REAL vendored draw.io editor mounted inside Mill --
// select → Edit → save → the board preview updates via the existing
// mirror watch (goal 0194), the external-app door stays untouched.
// Complements drawioEmbedProtocol.test.ts, which proves Mill's own
// protocol handling against a fake engine with no real asset involved;
// this file proves the real engine actually loads and speaks that same
// protocol inside the real app.

function diagramObjects(page: import('@playwright/test').Page) {
  return nonSeededBoardObjects(page, 'diagram')
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

test('double-click opens the real editor engine, and editing round-trips through the mirror file', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-atlas-drawio-editor-'))
  const file = path.join(dir, 'ZzE2eDrawioEditor.drawio')
  fs.writeFileSync(file, makeDrawioXML('Original'))

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await createBoardObjectViaRPC(page, 'diagram', { mirrorPath: file }, { X: -700, Y: 480 }, ATLAS_DEFAULT_SPACE_ID)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()

  const object = diagramObjects(page)
  await expect(object).toBeVisible()
  await expect(object.locator('svg')).toContainText('Original')

  await object.dblclick()

  const dialog = page.getByRole('dialog', { name: 'ZzE2eDrawioEditor.drawio' })
  await expect(dialog).toBeVisible()
  const editorFrame = dialog.getByTestId('drawio-editor-frame')
  await expect(editorFrame).toBeVisible()

  // The real engine actually mounted, not a blank/broken iframe -- its
  // own toolbar renders a "File" menu once init/load completes.
  const frame = page.frameLocator('[data-testid="drawio-editor-frame"]')
  await expect(frame.getByText('File', { exact: true })).toBeVisible({ timeout: 15000 })

  // Captured BEFORE the edit -- autosave can fire fast enough that
  // reading this AFTER the interaction below sometimes already
  // observes the edited bytes, which would make the poll below wait
  // forever for a change that already happened.
  const originalBytes = fs.readFileSync(file, 'utf8')

  // A real click on the seeded shape's own rendered label, then F2
  // (drawio's own rename-in-place shortcut) + real typed keystrokes +
  // Enter to commit -- genuine pointer/keyboard primitives, not a
  // dispatched event.
  await frame.getByText('Original', { exact: true }).click()
  await page.keyboard.press('F2')
  // Confirm text-edit mode actually started (the toolbar swaps from
  // insertion icons to font/style controls) before typing -- an
  // observable, retried condition instead of a blind keystroke
  // sequence racing the real editor's own selection/focus handling.
  await expect(frame.getByText('Helvetica', { exact: true }).first()).toBeVisible({ timeout: 10000 })
  await page.keyboard.type(' Edited')
  await page.keyboard.press('Enter')
  // Click empty canvas to force the label edit out of any lingering
  // live-editing state and deselect -- belt and suspenders alongside
  // Enter's own commit, since only a genuinely committed graph-model
  // change fires the protocol's 'autosave' event.
  await frame.locator('body').click({ position: { x: 700, y: 500 } })

  // The autosave round trip (drawioEmbedProtocol.ts's 'autosave' path)
  // writes real bytes to the SAME file this test created -- polled
  // since it crosses a postMessage + Go RPC + disk write, none of which
  // Playwright's own web-first assertions observe directly.
  await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 25000 }).not.toBe(originalBytes)

  // The Dialog's own close control -- DrawioEditorDialog.tsx wires it
  // to the SAME handleExit the protocol's own 'exit' event reaches
  // (drawioEmbedProtocol.test.ts's 'exit' case covers that path without
  // depending on the real engine's own Exit button/tooltip text, which
  // is locale/version-specific). The board's own face reflects the
  // edit through the EXISTING fsnotify watch -- no second update path.
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(object.locator('svg')).toContainText('Edited', { timeout: 10000 })

  await cleanUpObject(page, object)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('the context menu\'s Edit diagram item opens the same editor', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-atlas-drawio-editor-menu-'))
  const file = path.join(dir, 'ZzE2eDrawioEditorMenu.drawio')
  fs.writeFileSync(file, makeDrawioXML('Original'))

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await createBoardObjectViaRPC(page, 'diagram', { mirrorPath: file }, { X: -700, Y: 480 }, ATLAS_DEFAULT_SPACE_ID)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()

  const object = diagramObjects(page)
  await expect(object).toBeVisible()

  await object.click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await menu.getByText('Edit diagram…', { exact: true }).click()

  const dialog = page.getByRole('dialog', { name: 'ZzE2eDrawioEditorMenu.drawio' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('drawio-editor-frame')).toBeVisible()

  await page.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).not.toBeVisible()

  await cleanUpObject(page, object)
  fs.rmSync(dir, { recursive: true, force: true })
})
