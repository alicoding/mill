import { test, expect } from '@playwright/test'
import { clickRowAction } from './inventoryRow'

// Exercises ADR-0011's sectioned Request form + Manual schema editor
// end-to-end: authoring an operation's output field (with an alias and
// a nested extractPath) via the visual table, saving it, and confirming
// the real Go backend (synthesizeOpenAPISpec -> ConfigureService.
// CreateHTTPRequest -> openapispec.Parse -> HTTPRequestOperationFields)
// round-trips the alias/path correctly -- over real Go bindings (Wails3
// server mode), not mocks.

function requestRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="request"]').filter({ has: page.getByText(label, { exact: true }) })
}

// docs/adr/0014: the list is its own pinned tab now -- switch back to
// it first, since a still-open view/edit tab leaves the list panel
// `hidden` (Primer's TabPanel never unmounts, just toggles `hidden`),
// and a hidden element isn't clickable.
async function deleteRequest(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('link', { name: 'Configure' }).click()
  await clickRowAction(page, requestRow(page, label), 'Delete')
  await expect(requestRow(page, label)).toHaveCount(0)
}

test('Authoring a schema via the Manual editor round-trips alias/path through the real backend', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('Manual Schema Request')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')

  // The manual editor is always visible, pre-seeded with the request's
  // one implicit operation (1:1 model) -- no mode switch or "Add
  // operation", and Method is the request's own field (defaults GET).
  const editor = page.getByTestId('manual-schema-editor')
  await expect(editor).toBeVisible()
  const operation = editor.getByTestId('manual-operation')

  await operation.getByRole('button', { name: 'Add output field' }).click()
  const outputRow = operation.getByTestId('manual-field-row').last()
  await outputRow.getByLabel('Field name').fill('n')
  // Alias/extract-path live in the field's popup editor now (the
  // pencil), not inline -- the row shows them as badges once set.
  await outputRow.getByTestId('field-edit-open').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Alias').fill('widgetName')
  await dialog.getByLabel('Extract path').fill('data.name')
  await dialog.getByTestId('field-edit-done').click()

  await page.getByRole('button', { name: 'Save request' }).click()

  const row = requestRow(page, 'Manual Schema Request')
  await expect(row).toBeVisible()

  // docs/adr/0014: the declared schema is discoverable from the
  // read-only summary view, not an inline row expansion.
  await row.getByText('Manual Schema Request', { exact: true }).click()
  await expect(page.getByTestId('request-summary')).toBeVisible()
  // Scoped to the visible tabpanel -- Primer's TabPanel keeps every
  // panel mounted (toggles `hidden`, never unmounts), so an unscoped
  // getByText would also match Input parameters' and Testing's own
  // "Operation" displays. A single declared operation auto-selects, no
  // dropdown to drive (docs/SPEC.md §3.5's "no UI for a decision that
  // doesn't exist").
  const attrPanel = page.getByRole('tabpanel', { name: 'Available attributes' })
  await page.getByRole('tab', { name: 'Available attributes' }).click()

  await expect(attrPanel.getByText('widgetName (n)')).toBeVisible()
  await expect(attrPanel.getByText('path: data.name')).toBeVisible()

  await deleteRequest(page, 'Manual Schema Request')
})
