import { test, expect } from './fixtures/server'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { openCard } from './fixtures/atlasBoard'
import { clickRowAction } from './inventoryRow'

// Paste understanding (goal 0138): a diagram tool's clipboard payload
// (URI-encoded mxGraphModel XML -- what its copy actually puts on the
// system clipboard) becomes Mill entities on paste. Shared pool:
// every entity created here is deleted here.

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

async function pasteText(page: import('@playwright/test').Page, raw: string) {
  // The paste anchors at the pointer (a paste inside a frame files
  // into it, by design) -- aim at open canvas so the entities land at
  // top level where the full table face renders.
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

test('a pasted table selection becomes a Mill table with its List minted', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await pasteText(page, TABLE_XML)

  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'Pasted vendors' })
  await expect(tableCard).toBeVisible()
  await expect(tableCard.getByTestId('atlas-projection-table')).toContainText('Name')
  await expect(tableCard.getByTestId('atlas-projection-table')).toContainText('Acme')

  // Cleanup: card, then the minted List.
  await openCard(page, tableCard.locator('[class*="title"]').first())
  await deleteViaPageMenu(page, page.locator('[data-component="atlas-card-overlay"]'))
  await expect(tableCard).not.toBeVisible()
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Pasted vendors', { exact: true }) })
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
})
