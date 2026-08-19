import { test, expect } from './fixtures/server'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { ATLAS_KIND_DOCUMENT, selectKind } from './fixtures/kindPicker'
import { openCard } from './fixtures/atlasBoard'

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
