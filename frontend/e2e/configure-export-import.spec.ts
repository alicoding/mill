import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// Real Go bindings over HTTP (Wails3 server mode), not mocks -- same
// setup as composition-export-import.spec.ts, covering
// configureservice_export.go's three Configure entity types
// (HTTPRequest, List, MCPServer). Each test deletes what it creates,
// per this repo's own established discipline for the shared e2e
// settings file (see composition.spec.ts's header comment).

test('Exporting a Request downloads JSON that never carries its secret', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Integrations', exact: true }).click()

  const row = page.locator('[data-testid="inventory-row"][data-entity="request"]', { has: page.getByText('Example: API key header', { exact: false }) }).first()
  await expect(row).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await clickRowAction(page, row, 'Export')
  const download = await downloadPromise

  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf-8')
  const parsed = JSON.parse(text)

  expect(typeof parsed.id).toBe('string')
  expect(parsed.id.length).toBeGreaterThan(0)
  expect(parsed.schema).toBe('mill://schema/request/v1')
  expect(typeof parsed.label).toBe('string')
  // The seeded API-key example has a real demo secret in the keychain
  // (docs/SPEC.md §4's Update) -- if it ever leaked into export output,
  // it would appear as a literal string in this JSON.
  expect(text).not.toContain('demo-api-key-do-not-use-in-production')
})

test('Importing a Request file adds a new, independent request', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Integrations', exact: true }).click()

  const importJSON = JSON.stringify({
    label: 'E2E imported request',
    baseURL: 'https://example.com',
    authType: 'none',
  })
  await page.getByTestId('import-request').click()
  await page.getByTestId('import-request-input').setInputFiles({
    name: 'request.json',
    mimeType: 'application/json',
    buffer: Buffer.from(importJSON, 'utf-8'),
  })

  const importedRow = page.locator('[data-testid="inventory-row"][data-entity="request"]', { has: page.getByText('E2E imported request', { exact: true }) })
  await expect(importedRow).toBeVisible()

  await clickRowAction(page, importedRow, 'Delete')
  await expect(importedRow).toHaveCount(0)
})

test('Exporting and importing a List round-trips its typed columns and rows', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()

  await page.getByTestId('new-list').click()
  await page.getByLabel('Label').fill('E2E export list')
  await page.getByTestId('list-column-key').fill('color')
  await page.getByRole('button', { name: 'Save list' }).click()

  await page.getByTestId('add-list-row').click()
  await page.getByTestId('list-row').getByRole('textbox').fill('blue')
  await page.getByTestId('save-list-row').click()

  const originalRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('E2E export list', { exact: true }) })
  await expect(originalRow).toBeVisible()
  await expect(originalRow).toContainText('1 columns, 1 rows')

  const downloadPromise = page.waitForEvent('download')
  await clickRowAction(page, originalRow, 'Export')
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const json = Buffer.concat(chunks).toString('utf-8')
  const parsed = JSON.parse(json)
  // internal/domain/typedfield.Field and internal/domain/list.Row carry
  // no json struct tags of their own, so their fields marshal under
  // their real Go names (Key, Values, ...) even though the top-level
  // exportedList wrapper fields do (columns/rows, configureservice_
  // export.go's own json tags).
  expect(typeof parsed.id).toBe('string')
  expect(parsed.columns).toHaveLength(1)
  expect(parsed.columns[0].Key).toBe('color')
  expect(parsed.rows).toHaveLength(1)
  expect(parsed.rows[0].Values.color).toBe('blue')

  // Re-importing this export's id matches the list still sitting here
  // (ADR-0036 decision 3), so the file-picker confirms the update
  // before applying it (the same visibility bar every import surface
  // now shares) rather than silently creating a duplicate.
  await page.getByTestId('import-list').click()
  await page.getByTestId('import-list-input').setInputFiles({
    name: 'list.json',
    mimeType: 'application/json',
    buffer: Buffer.from(json, 'utf-8'),
  })
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('E2E export list')
  await dialog.getByRole('button', { name: 'Update' }).click()

  const rows = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('E2E export list', { exact: true }) })
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText('1 columns, 1 rows')

  await clickRowAction(page, rows, 'Delete')
  await expect(page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('E2E export list', { exact: true }) })).toHaveCount(0)
})

test('Importing invalid JSON into an MCP Server shows an error', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'MCP Servers' }).click()

  await page.getByTestId('import-mcpserver').click()
  await page.getByTestId('import-mcpserver-input').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('not valid json', 'utf-8'),
  })

  await expect(page.getByTestId('import-mcpserver-error')).toBeVisible()
})
