import { test, expect } from './fixtures/server'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { ATLAS_KIND_DOCUMENT, selectKind } from './fixtures/kindPicker'
import { openCard } from './fixtures/atlasBoard'
import { clickRowAction } from './inventoryRow'

// List → table projection (goal 0105 minimal slice): "Table from a
// List" lands a card that renders the seeded List live and read-only,
// on the board face and on the card page. Shared worker pool: creates
// its own card and deletes it; reads (never writes) the seeded
// "Example: Country codes" List.
test('a table card projects a List live on the board and its page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await page.getByTestId('atlas-add-button').click()
  await page.getByTestId('atlas-add-table').click()
  await page.getByTestId('entity-ref-field').selectOption({ label: 'Example: Country codes' })
  // Picking the List prefilled the title with its label.
  await expect(page.getByTestId('atlas-create-title')).toHaveValue('Example: Country codes')
  await selectKind(page, ATLAS_KIND_DOCUMENT, 'atlas-create-kind')
  await page.getByRole('button', { name: 'Create' }).click()

  // The board face renders the live table: real column headers and a
  // real seeded row.
  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'Example: Country codes' })
  await expect(tableCard).toBeVisible()
  await expect(tableCard.getByTestId('atlas-projection-table')).toContainText('Code')
  await expect(tableCard.getByTestId('atlas-projection-table')).toContainText('US')

  // The page renders the same table plus the write-path caption.
  await openCard(page, tableCard)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  const projection = overlay.getByTestId('atlas-page-projection')
  await expect(projection).toBeVisible()
  await expect(projection.getByTestId('atlas-projection-table')).toContainText('US')
  await expect(projection).toContainText('mirrors a List')

  // Cleanup.
  await deleteViaPageMenu(page, overlay)
  await expect(tableCard).not.toBeVisible()
})

// Auto-arrange packs the projection at its REAL footprint (the
// packer's own projection branch) -- the table face survives the
// action instead of being overlapped by note-sized packing.
test('auto-arrange keeps the table face at its real footprint', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await page.getByTestId('atlas-add-button').click()
  await page.getByTestId('atlas-add-table').click()
  await page.getByTestId('entity-ref-field').selectOption({ label: 'Example: Country codes' })
  await selectKind(page, ATLAS_KIND_DOCUMENT, 'atlas-create-kind')
  await page.getByTestId('atlas-create-title').fill('ZzE2eProjectionArrangeCard')
  await page.getByRole('button', { name: 'Create' }).click()
  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'ZzE2eProjectionArrangeCard' })
  await expect(tableCard).toBeVisible()

  await page.getByRole('button', { name: 'Auto-arrange' }).click()
  await expect(tableCard).toBeVisible()
  await expect(tableCard.getByTestId('atlas-projection-table')).toContainText('Code')

  // Cleanup.
  await openCard(page, tableCard)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await deleteViaPageMenu(page, overlay)
})

// In-place editing (goal 0105 part 2, the draw.io-friction killer):
// boundary ⊕ inserts a row exactly where pointed, a clicked cell
// edits in place, and a new column arrives named in place -- all
// committing through the List's own write path (a scratch List
// created here, so the seeded one is never written).
test('boundary inserts, cell edits, and column rename all work in place on the card page', async ({ page }) => {
  await page.goto('/')
  // A scratch List via Configure, so this test owns everything it edits.
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  await page.getByTestId('new-list').click()
  await page.getByLabel('Label', { exact: true }).fill('ZzE2eProjectionEditList')
  await page.getByTestId('save-list').click()

  await page.getByRole('link', { name: 'Atlas' }).click()
  await page.getByTestId('atlas-add-button').click()
  await page.getByTestId('atlas-add-table').click()
  await page.getByTestId('entity-ref-field').selectOption({ label: 'ZzE2eProjectionEditList' })
  await selectKind(page, ATLAS_KIND_DOCUMENT, 'atlas-create-kind')
  await page.getByRole('button', { name: 'Create' }).click()

  const tableCard = page.getByTestId('atlas-table-card').filter({ hasText: 'ZzE2eProjectionEditList' })
  await openCard(page, tableCard)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  const table = overlay.getByTestId('atlas-projection-table')
  await expect(table).toBeVisible()

  // Empty List: the honest invitation, then + Column names itself in
  // place (auto label -> immediate rename input).
  await expect(table).toContainText('No columns yet')
  await table.getByTestId('atlas-projection-add-column').click()
  await table.getByTestId('atlas-projection-rename-input').fill('Vendor')
  await table.getByTestId('atlas-projection-rename-input').press('Enter')
  await expect(table.getByTestId('atlas-projection-header')).toContainText('Vendor')

  // + Row, then edit the cell in place.
  await table.getByTestId('atlas-projection-add-row').click()
  const firstCell = table.getByTestId('atlas-projection-cell').first()
  await firstCell.click()
  await table.getByTestId('atlas-projection-cell-input').fill('Acme')
  await table.getByTestId('atlas-projection-cell-input').press('Enter')
  await expect(firstCell).toContainText('Acme')

  // Boundary ⊕ on the row inserts BELOW it; fill the new row and
  // confirm the order (Acme stays first).
  await table.getByTestId('atlas-projection-row').first().hover()
  await table.getByTestId('atlas-projection-insert-row').first().click()
  await expect(table.getByTestId('atlas-projection-row')).toHaveCount(2)
  const secondCell = table.getByTestId('atlas-projection-row').nth(1).getByTestId('atlas-projection-cell').first()
  await secondCell.click()
  await table.getByTestId('atlas-projection-cell-input').fill('Beta Corp')
  await table.getByTestId('atlas-projection-cell-input').press('Enter')
  await expect(table.getByTestId('atlas-projection-row').nth(0)).toContainText('Acme')
  await expect(table.getByTestId('atlas-projection-row').nth(1)).toContainText('Beta Corp')

  // Boundary ⊕ on the header inserts a column after it.
  await table.getByTestId('atlas-projection-header').first().hover()
  await table.getByTestId('atlas-projection-insert-column').first().click()
  await table.getByTestId('atlas-projection-rename-input').fill('Status')
  await table.getByTestId('atlas-projection-rename-input').press('Enter')
  await expect(table.getByTestId('atlas-projection-header').nth(0)).toContainText('Vendor')
  await expect(table.getByTestId('atlas-projection-header').nth(1)).toContainText('Status')

  // Cleanup: the card, then the scratch List.
  await deleteViaPageMenu(page, overlay)
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('ZzE2eProjectionEditList', { exact: true }) })
  await clickRowAction(page, listRow, 'Delete')
  await expect(listRow).toHaveCount(0)
})
