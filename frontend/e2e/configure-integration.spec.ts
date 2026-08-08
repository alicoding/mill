import { test, expect } from '@playwright/test'

// Exercises ADR-0007's Connector OpenAPI schema (Phase 2): a Connector
// can declare an OpenAPI spec at Configure time, and "List operations"
// surfaces its declared path+method operations -- the same
// discoverability pattern MCP Server's "List tools" already has (§3.6),
// over real Go bindings (Wails3 server mode), not mocks.
//
// Each test deletes the connector it creates at the end -- the shared
// e2e settings file (MILL_SETTINGS_PATH, playwright.config.ts) persists
// across every spec file and every repeated run, so a connector left
// behind (unlike this repo's other e2e-created entities, which already
// all clean up after themselves -- see composition.spec.ts) would
// accumulate duplicate rows and break a plain label-text filter the
// next time this suite runs.

const sampleSpec = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Sample', version: '1.0.0' },
  paths: {
    '/widgets': {
      get: { summary: 'List widgets', responses: { 200: { description: 'OK' } } },
    },
  },
})

function connectorRow(page: import('@playwright/test').Page, label: string) {
  return page.getByTestId('connector-row').filter({ has: page.getByText(label, { exact: true }) })
}

async function deleteConnector(page: import('@playwright/test').Page, label: string) {
  await connectorRow(page, label).getByRole('button', { name: `Delete ${label}` }).click()
  await expect(connectorRow(page, label)).toHaveCount(0)
}

test('Creating a connector with an OpenAPI spec and listing its operations', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-connector').click()
  await page.getByLabel('Label').fill('Sample Connector')
  await page.getByLabel('Base URL').fill('https://api.example.com')
  await page.getByTestId('connector-openapi-spec').fill(sampleSpec)
  await page.getByRole('button', { name: 'Save connector' }).click()

  const row = connectorRow(page, 'Sample Connector')
  await expect(row).toBeVisible()

  await row.getByTestId('list-operations').click()
  const operations = row.getByTestId('connector-operations')
  await expect(operations).toBeVisible()
  await expect(operations.getByText('/widgets')).toBeVisible()
  // exact: true -- Playwright's default substring+case-insensitive
  // match would otherwise also match "wid-GET-s" inside "/widgets"'s
  // own text.
  await expect(operations.getByText('GET', { exact: true })).toBeVisible()

  await deleteConnector(page, 'Sample Connector')
})

test('An invalid OpenAPI spec is rejected with a visible error', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-connector').click()
  await page.getByLabel('Label').fill('Broken Connector')
  await page.getByLabel('Base URL').fill('https://api.example.com')
  await page.getByTestId('connector-openapi-spec').fill('not an openapi spec')
  await page.getByRole('button', { name: 'Save connector' }).click()

  // "OpenAPI spec: ..." (the error's own wrapped-message prefix,
  // configureservice.go's validateOpenAPISpec) -- distinct from the
  // form's own "OpenAPI spec (optional)" label and the textarea's
  // literal value text, both of which also match a bare /OpenAPI spec/i.
  await expect(page.getByText(/OpenAPI spec:/i)).toBeVisible()

  // Save was rejected (the error above proves it) -- nothing was
  // persisted, so no cleanup needed; cancel the still-open form instead
  // of leaving it open for the next test.
  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('A connector with no OpenAPI spec shows no "List operations" action', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-connector').click()
  await page.getByLabel('Label').fill('Plain Connector')
  await page.getByLabel('Base URL').fill('https://api.example.com')
  await page.getByRole('button', { name: 'Save connector' }).click()

  const row = connectorRow(page, 'Plain Connector')
  await expect(row).toBeVisible()
  await expect(row.getByTestId('list-operations')).not.toBeVisible()

  await deleteConnector(page, 'Plain Connector')
})
