import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures/server'
import { clickGlideCell, glideCellText } from './fixtures/glideGrid'
import { addGridColumn } from './fixtures/listGrid'
import { clickRowAction } from './inventoryRow'
import { openConfigureKind } from './fixtures/configureNav'

const XLSX_FIXTURE = path.join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'files', 'sample-import.xlsx')

function listRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText(label, { exact: true }) })
}

// docs/goals/0133 slice 4: an .xlsx workbook parses through the Go-side
// excelize path (ParseXlsxFile) into the SAME ParsedFile shape CSV
// import already produces, so it drives the identical mapping-preview/
// confirm UI configure-lists.spec.ts's CSV test already proves --
// scoped here to xlsx's own byte-transfer/parsing path, not a re-proof
// of the shared mapping/validation logic (autoMatchColumns,
// buildMappedRows) that spec already covers. Fixture columns/rows
// (SKU/Amount, one malformed "Amount") mirror
// fixtures/list-import-sample.csv's own CSV row-import fixture on
// purpose, so the two tests prove the two byte paths converge on
// identical behaviour.
test('Configure > Lists: .xlsx import — mapping preview populated from a real spreadsheet, confirm applies', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Lists')

  await page.getByTestId('new-list').click()
  await page.getByLabel('Label').fill('E2E xlsx import list')
  await page.getByRole('button', { name: 'Save list' }).click()
  await expect(page.getByTestId('list-rows-editor')).toBeVisible()
  await addGridColumn(page, 'SKU')
  await addGridColumn(page, 'Amount')
  // Amount becomes a number column, same schema the CSV import test uses
  // -- lets the same "oops" row prove typed validation still runs on an
  // xlsx-sourced value, not just a CSV-sourced one.
  const glide = page.getByTestId('atlas-projection-glide')
  await clickGlideCell(page, glide, -1, 1, { button: 'right' })
  await page.getByTestId('list-grid-column-settings-amount').click()
  await page.getByTestId('list-grid-column-type').selectOption('number')
  await page.keyboard.press('Escape')
  await expect(glide).toHaveAttribute('data-col-types', 'text,number')

  await page.getByTestId('import-list-rows').click()
  await page.getByTestId('import-list-rows-input').setInputFiles(XLSX_FIXTURE)

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const mapping = dialog.getByTestId('import-list-rows-mapping')
  // The mapping Selects are populated from the WORKBOOK's own header
  // row -- proof the bytes actually round-tripped through excelize,
  // not just that the dialog opened.
  await expect(mapping.locator('select').first()).toHaveValue('sku')
  await expect(mapping.locator('select').nth(1)).toHaveValue('amount')

  await expect(dialog.getByTestId('import-list-rows-count')).toContainText('1 row ready to import, 1 skipped')
  const skipped = dialog.getByTestId('import-list-rows-skipped')
  await expect(skipped).toContainText('Row 2')
  await expect(skipped).toContainText('"Amount" must be a number')

  await page.getByRole('button', { name: 'Import 1 row' }).click()
  await expect(dialog).toHaveCount(0)

  const result = page.getByTestId('import-list-rows-result')
  await expect(result).toContainText('Imported 1 row.')

  // Only the valid row landed as a real List row.
  await expect(glide).toHaveAttribute('data-rows', '1')
  await expect(glideCellText(glide, 0, 0)).toHaveText('WIDGET-1')

  // Clean up.
  await page.getByTestId('configure-lists').getByRole('button', { name: 'Close' }).click()
  const row = listRow(page, 'E2E xlsx import list')
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
})
