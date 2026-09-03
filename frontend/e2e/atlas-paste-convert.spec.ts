import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './fixtures/server'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { closeCard, deleteSticky, openCard } from './fixtures/atlasBoard'
import { clickRowAction } from './inventoryRow'
import { contextMenu } from './fixtures/contextMenu'

// Paste understanding (goal 0138): a diagram tool's clipboard payload
// (URI-encoded mxGraphModel XML -- what its copy actually puts on the
// system clipboard) becomes Mill entities on paste. A table-shaped
// paste lands as a board-local "table" object (goal 0179 S2), never a
// card -- deleted here straight off the board, no page to open. Shared
// pool: every entity created here is deleted here.

function tableObjects(page: import('@playwright/test').Page) {
  return page.locator('[data-testid="atlas-board-object"][data-object-kind="table"]')
}

async function deleteObjectViaMenu(object: import('@playwright/test').Locator) {
  const page = object.page()
  await object.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
}

const DIAGRAM_XML = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
  + '<mxCell id="2" value="Vendor API" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60"/></mxCell>'
  + '<mxCell id="3" value="Billing" vertex="1" parent="1"><mxGeometry x="240" y="40" width="120" height="60"/></mxCell>'
  + '<mxCell id="4" value="calls" edge="1" parent="1" source="2" target="3"/></root></mxGraphModel>'

const TABLE_XML = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
  + '<mxCell id="t" value="Pasted vendors" style="shape=table;html=1" vertex="1" parent="1"><mxGeometry x="0" y="0" width="200" height="90"/></mxCell>'
  + '<mxCell id="r1" style="shape=tableRow;html=1" vertex="1" parent="t"><mxGeometry y="0" width="200" height="30"/></mxCell>'
  + '<mxCell id="c11" value="Name" vertex="1" parent="r1"><mxGeometry x="0" width="100" height="30"/></mxCell>'
  + '<mxCell id="c12" value="Status" vertex="1" parent="r1"><mxGeometry x="100" width="100" height="30"/></mxCell>'
  + '<mxCell id="r2" style="shape=tableRow;html=1" vertex="1" parent="t"><mxGeometry y="30" width="200" height="30"/></mxCell>'
  + '<mxCell id="c21" value="Acme" vertex="1" parent="r2"><mxGeometry x="0" width="100" height="30"/></mxCell>'
  + '<mxCell id="c22" value="Healthy" vertex="1" parent="r2"><mxGeometry x="100" width="100" height="30"/></mxCell>'
  + '</root></mxGraphModel>'

// pasteHTML injects both flavors real M365 apps carry together (goal
// 0218's own root-cause trace): the table's own HTML plus a tab-less
// plain-text sibling that TSV's recognizer would never fire on --
// proving the HTML recognizer, not a TSV coincidence, is what lands
// the table.
async function pasteHTML(page: import('@playwright/test').Page, html: string, plainTextSibling: string) {
  // eslint-disable-next-line no-restricted-syntax -- cursor-position-only gesture, not a checkable interaction (pasteText's own comment above has the full reasoning)
  await page.mouse.move(1000, 220)
  await page.evaluate(({ html: h, text }) => {
    const dt = new DataTransfer()
    dt.setData('text/html', h)
    dt.setData('text/plain', text)
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, { html, text: plainTextSibling })
}

// pastePlainText injects text/plain VERBATIM (unlike pasteText below,
// which URI-encodes to mimic the diagram tool's own copy format) --
// the shape a copied file path or ordinary prose actually has.
async function pastePlainText(page: import('@playwright/test').Page, raw: string) {
  // eslint-disable-next-line no-restricted-syntax -- cursor-position-only gesture, not a checkable interaction (pasteText's own comment below has the full reasoning)
  await page.mouse.move(1000, 220)
  await page.evaluate((t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, raw)
}

async function pasteText(page: import('@playwright/test').Page, raw: string) {
  // The paste anchors at the pointer (a paste inside a frame files
  // into it, by design) -- aim at open canvas so the entities land at
  // top level where the full table face renders. A pure cursor-
  // position gesture, not an interaction (canvas-clipboard.spec.ts's
  // own comment has the full reasoning, goal 0184 migration probe).
  // eslint-disable-next-line no-restricted-syntax -- cursor-position-only gesture, not a checkable interaction (see comment above)
  await page.mouse.move(1000, 220)
  await page.evaluate((xml) => {
    const dt = new DataTransfer()
    // The tool's copy writes encodeURIComponent(xml) as text/plain --
    // pasting that exact form proves the decode ladder end to end.
    dt.setData('text/plain', encodeURIComponent(xml))
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, raw)
}

test('a pasted diagram selection becomes titled cards with their link', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await pasteText(page, DIAGRAM_XML)

  const vendor = page.locator('[data-testid="atlas-note-card"]').filter({ hasText: 'Vendor API' })
  const billing = page.locator('[data-testid="atlas-note-card"]').filter({ hasText: 'Billing' })
  await expect(vendor).toBeVisible()
  await expect(billing).toBeVisible()

  // Cleanup both cards (the link dies with them).
  for (const card of [vendor, billing]) {
    await openCard(page, card)
    await deleteViaPageMenu(page, page.locator('[data-component="atlas-card-overlay"]'))
    await expect(card).not.toBeVisible()
  }
})

test('a pasted table selection becomes a board-local table object with its List minted', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await pasteText(page, TABLE_XML)

  const tableObject = tableObjects(page).filter({ hasText: 'Acme' })
  await expect(tableObject).toBeVisible()
  await expect(tableObject.getByTestId('atlas-projection-glide').locator('[role="grid"]')).toContainText('Name')
  // The rule, absolute: pasting never creates a card the user didn't
  // explicitly ask for.
  await expect(page.getByTestId('atlas-table-card')).toHaveCount(0)

  // Cleanup: the object, then the minted List.
  await deleteObjectViaMenu(tableObject)
  await expect(tableObject).toHaveCount(0)
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Pasted vendors', { exact: true }) })
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
})

// Slice 2 (goal 0138): a copied spreadsheet range (TSV text) becomes
// a Mill table through the same paste surface.
test('a pasted spreadsheet range becomes a board-local table object', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // eslint-disable-next-line no-restricted-syntax -- cursor-position-only gesture, not a checkable interaction (pasteText's own comment has the full reasoning)
  await page.mouse.move(1000, 220)
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.setData('text/plain', 'Name\tStatus\nAcme\tHealthy')
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })

  const tableObject = tableObjects(page).filter({ hasText: 'Acme' })
  await expect(tableObject).toBeVisible()
  await expect(tableObject.getByTestId('atlas-projection-glide').locator('[role="grid"]')).toContainText('Acme')

  // Cleanup: the object, then the minted List.
  await deleteObjectViaMenu(tableObject)
  await expect(tableObject).toHaveCount(0)
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Imported table', { exact: true }) })
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
})

// Word-shaped clipboard HTML (goal 0218's own M365 root cause): mso-
// classes, a VML conditional-comment block, and an <o:p> empty-
// paragraph marker -- the exact noise a real Word copy carries
// alongside its table. plainTextSibling has no tabs at all (Word's own
// plain-text fallback for a table is space-padded columns, never TSV),
// so a table landing here proves the HTML recognizer fired, not TSV.
const WORD_TABLE_HTML = '<html xmlns:o="urn:schemas-microsoft-com:office:office">'
  + '<head><style><!-- @font-face {font-family:"Cambria Math";} --></style></head>'
  + '<body><!--[if gte mso 9]><xml><o:shapedefaults/></xml><![endif]-->'
  + '<!--StartFragment-->'
  + '<table class=MsoTableGrid border=1><tr>'
  + '<td><p class=MsoNormal>Vendor<o:p></o:p></p></td>'
  + '<td><p class=MsoNormal>Status<o:p></o:p></p></td>'
  + '</tr><tr>'
  + '<td><p class=MsoNormal>Acme Corp<o:p></o:p></p></td>'
  + '<td><p class=MsoNormal>Healthy<o:p></o:p></p></td>'
  + '</tr></table>'
  + '<!--EndFragment--></body></html>'

test('a table copied from an M365 app (HTML clipboard flavor) lands a board-local table object, never a card', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await pasteHTML(page, WORD_TABLE_HTML, 'Vendor    Status')

  const tableObject = tableObjects(page).filter({ hasText: 'Acme Corp' })
  await expect(tableObject).toBeVisible()
  await expect(tableObject.getByTestId('atlas-projection-glide').locator('[role="grid"]')).toContainText('Vendor')
  // The rule, absolute: pasting never creates a card the user didn't
  // explicitly ask for.
  await expect(page.getByTestId('atlas-table-card')).toHaveCount(0)

  // Cleanup: the object, then the minted List.
  await deleteObjectViaMenu(tableObject)
  await expect(tableObject).toHaveCount(0)
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Pasted table', { exact: true }) })
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
})

// Regression: pasting a local file PATH (text) landed a sticky note
// containing the raw path string, while DROPPING the same file landed
// the real thing (goal 0179's founding rule). A pasted path now routes
// through the drop door's own landing pipeline: .md becomes a mirrored
// document card, .drawio a diagram board object -- and a path that
// doesn't resolve on disk still falls back to the note, never a dead
// end.
test('pasting a file path lands what dropping the file would; a dead path still falls back to a note', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-paste-path-'))
  const mdPath = path.join(dir, 'ZzE2ePastedDocPath.md')
  fs.writeFileSync(mdPath, '# Pasted doc\n\nbody\n')
  const drawioPath = path.join(dir, 'ZzE2ePastedDiagramPath.drawio')
  fs.writeFileSync(drawioPath, '<mxfile><diagram name="P">'
    + '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
    + '<mxCell id="2" value="Box" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40"/></mxCell>'
    + '</root></mxGraphModel></diagram></mxfile>')
  try {
    await page.goto('/')
    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(page.getByTestId('atlas-board')).toBeVisible()

    // .md path -> mirrored document card, exactly like dropping the file.
    await pastePlainText(page, mdPath)
    const card = page.getByTestId('atlas-note-card').filter({ hasText: 'ZzE2ePastedDocPath' })
    await expect(card).toBeVisible()
    await expect(page.getByTestId('atlas-sticky-note').filter({ hasText: 'ZzE2ePastedDocPath' })).toHaveCount(0)

    // .drawio path -> diagram board object, never a card or note.
    await pastePlainText(page, drawioPath)
    const diagram = page.locator('[data-testid="atlas-board-object"][data-object-kind="diagram"]')
    await expect(diagram).toHaveCount(1)
    await expect(page.getByTestId('atlas-note-card').filter({ hasText: 'ZzE2ePastedDiagramPath' })).toHaveCount(0)

    // A path-shaped string that doesn't exist stays ordinary text: the
    // note fallback, so nothing a user pastes ever vanishes.
    const deadPath = path.join(dir, 'ZzE2eDeadPath.md')
    await pastePlainText(page, deadPath)
    const note = page.getByTestId('atlas-sticky-note').filter({ hasText: 'ZzE2eDeadPath' })
    await expect(note).toBeVisible()

    // Cleanup (shared pool): note, diagram object, card.
    await deleteSticky(page, note)
    await deleteObjectViaMenu(diagram)
    await expect(diagram).toHaveCount(0)
    await card.click({ button: 'right' })
    const menu = contextMenu(page)
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
    await expect(card).toHaveCount(0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// Regression: the board's window-level paste door stayed live while a
// card page (a modal dialog) covered the board -- pasting with focus
// on no field landed a sticky note INVISIBLY behind the dialog. The
// door now stands down while a modal surface is open, and comes back
// the moment it closes.
test('pasting while a card page is open lands nothing behind it; the door returns on close', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const card = page.getByTestId('atlas-note-card').filter({ hasText: 'Discovery workstream' }).first()
  await openCard(page, card)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  // Land focus on nothing editable: click the page's own header region
  // (the real state a user reaches by clicking any non-field area).
  await page.getByTestId('atlas-page-header').click()

  await pastePlainText(page, 'ZzE2eModalGateProbe')
  // No observable "nothing happened" signal exists to await -- a fixed
  // settle window is the only way to assert the note did NOT land.
  await page.waitForTimeout(800) // asserting a no-op: no observable condition exists to await
  await expect(page.getByTestId('atlas-sticky-note').filter({ hasText: 'ZzE2eModalGateProbe' })).toHaveCount(0)

  await closeCard(page, overlay)

  // The same paste with the board foreground again lands its note.
  await pastePlainText(page, 'ZzE2eModalGateProbe')
  const note = page.getByTestId('atlas-sticky-note').filter({ hasText: 'ZzE2eModalGateProbe' })
  await expect(note).toBeVisible()
  await deleteSticky(page, note)
})
