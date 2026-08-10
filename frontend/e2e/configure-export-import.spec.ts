import { test, expect } from '@playwright/test'
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
  await page.getByRole('tab', { name: 'Integration', exact: true }).click()

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

  expect(parsed.id).toBeUndefined()
  expect(typeof parsed.label).toBe('string')
  // The seeded API-key example has a real demo secret in the keychain
  // (docs/SPEC.md §4's Update) -- if it ever leaked into export output,
  // it would appear as a literal string in this JSON.
  expect(text).not.toContain('demo-api-key-do-not-use-in-production')
})

test('Importing a Request file adds a new, independent request', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Integration', exact: true }).click()

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

test('Exporting and importing a List round-trips its entries', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Lists' }).click()

  await page.getByTestId('new-list').click()
  await page.getByLabel('Label').fill('E2E export list')
  await page.getByPlaceholder('key').fill('color')
  await page.getByPlaceholder('value').fill('blue')
  await page.getByRole('button', { name: 'Save list' }).click()

  const originalRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('E2E export list', { exact: true }) })
  await expect(originalRow).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await clickRowAction(page, originalRow, 'Export')
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const json = Buffer.concat(chunks).toString('utf-8')
  expect(JSON.parse(json).entries).toEqual({ color: 'blue' })

  await page.getByTestId('import-list').click()
  await page.getByTestId('import-list-input').setInputFiles({
    name: 'list.json',
    mimeType: 'application/json',
    buffer: Buffer.from(json, 'utf-8'),
  })

  const rows = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('E2E export list', { exact: true }) })
  await expect(rows).toHaveCount(2)

  // Clean up both -- the original and the import.
  for (let i = 0; i < 2; i++) {
    const remaining = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('E2E export list', { exact: true }) }).first()
    await clickRowAction(page, remaining, 'Delete')
  }
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
