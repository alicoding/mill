import { test, expect } from '@playwright/test'

// Exercises ADR-0007's Connector OpenAPI schema (Phase 2): a Connector
// can declare an OpenAPI spec at Configure time, and its declared
// operations/fields are discoverable from the read-only summary view
// (docs/adr/0014) -- the same discoverability pattern MCP Server's
// "List tools" already has (§3.6), over real Go bindings (Wails3
// server mode), not mocks.
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

const schemaSpec = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Schema Sample', version: '1.0.0' },
  paths: {
    '/widgets/{id}': {
      get: {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { name: { type: 'string' }, token: { type: 'string', format: 'password' } } },
              },
            },
          },
        },
      },
    },
  },
})

function connectorRow(page: import('@playwright/test').Page, label: string) {
  return page.getByTestId('connector-row').filter({ has: page.getByText(label, { exact: true }) })
}

// docs/adr/0014: the list is its own pinned tab now -- switch back to
// it first, since a still-open view/edit tab leaves the list panel
// `hidden` (Primer's TabPanel never unmounts, just toggles `hidden`),
// and a hidden element isn't clickable.
async function deleteConnector(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('tab', { name: 'Connectors' }).click()
  await connectorRow(page, label).getByRole('button', { name: `Delete ${label}` }).click()
  await expect(connectorRow(page, label)).toHaveCount(0)
}

// docs/adr/0014: clicking a connector row opens its read-only summary
// as its own pinned tab (ConnectorSummary.tsx), replacing the old
// inline expand-in-place "List operations" row.
async function openConnectorView(page: import('@playwright/test').Page, label: string) {
  await connectorRow(page, label).getByText(label, { exact: true }).click()
  await expect(page.getByTestId('connector-summary')).toBeVisible()
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

  await openConnectorView(page, 'Sample Connector')
  await page.getByRole('tab', { name: 'Available attributes' }).click()
  // Primer's TabPanel keeps every panel mounted (toggles `hidden`, never
  // unmounts), and the Testing tab has its own "Operation" select too --
  // an unscoped getByLabel would match all three. Scope to the visible
  // tabpanel, same discipline composition e2e specs already use.
  const attrPanel = page.getByRole('tabpanel', { name: 'Available attributes' })
  await expect(attrPanel.getByLabel('Operation').locator('option', { hasText: 'GET /widgets' })).toHaveCount(1)

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

test('A connector persists custom headers and shows them in its Details tab', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-connector').click()
  await page.getByLabel('Label').fill('Header Connector')
  await page.getByLabel('Base URL').fill('https://api.example.com')
  await page.getByTestId('add-connector-header').click()
  await page.getByTestId('connector-header-key').fill('X-Client-Version')
  await page.getByTestId('connector-header-value').fill('42')
  await page.getByRole('button', { name: 'Save connector' }).click()

  const row = connectorRow(page, 'Header Connector')
  await expect(row).toBeVisible()

  await openConnectorView(page, 'Header Connector')
  await expect(page.getByText(/X-Client-Version: 42/)).toBeVisible()

  // Round-trips through Edit too, not just the initial Save.
  await page.getByTestId('summary-edit').click()
  await expect(page.getByTestId('connector-header-key')).toHaveValue('X-Client-Version')
  await expect(page.getByTestId('connector-header-value')).toHaveValue('42')
  await page.getByRole('button', { name: 'Cancel' }).click()

  await deleteConnector(page, 'Header Connector')
})

test('Showing an operation\'s schema reveals its declared fields, with the secret one flagged', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-connector').click()
  await page.getByLabel('Label').fill('Schema Connector')
  await page.getByLabel('Base URL').fill('https://api.example.com')
  await page.getByTestId('connector-openapi-spec').fill(schemaSpec)
  await page.getByRole('button', { name: 'Save connector' }).click()

  await openConnectorView(page, 'Schema Connector')

  // Input parameters: the path param. Scoped to the visible tabpanel --
  // Primer's TabPanel keeps every panel mounted (toggles `hidden`, never
  // unmounts), so an unscoped getByLabel would match this tab's,
  // Available attributes', and Testing's own "Operation" selects.
  const inputPanel = page.getByRole('tabpanel', { name: 'Input parameters' })
  await page.getByRole('tab', { name: 'Input parameters' }).click()
  await inputPanel.getByLabel('Operation').selectOption({ label: 'GET /widgets/{id}' })
  await expect(inputPanel.getByText('id', { exact: true })).toBeVisible()

  // Available attributes: the response fields, including the
  // secret-flagged one.
  const attrPanel = page.getByRole('tabpanel', { name: 'Available attributes' })
  await page.getByRole('tab', { name: 'Available attributes' }).click()
  await attrPanel.getByLabel('Operation').selectOption({ label: 'GET /widgets/{id}' })
  await expect(attrPanel.getByText('name', { exact: true })).toBeVisible()
  await expect(attrPanel.getByText('token', { exact: true })).toBeVisible()
  await expect(attrPanel.getByText('secret')).toBeVisible()

  await deleteConnector(page, 'Schema Connector')
})

test('A connector with no OpenAPI spec shows no declared schema', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-connector').click()
  await page.getByLabel('Label').fill('Plain Connector')
  await page.getByLabel('Base URL').fill('https://api.example.com')
  await page.getByRole('button', { name: 'Save connector' }).click()

  const row = connectorRow(page, 'Plain Connector')
  await expect(row).toBeVisible()

  await openConnectorView(page, 'Plain Connector')
  const panel = page.getByRole('tabpanel', { name: 'Input parameters' })
  await page.getByRole('tab', { name: 'Input parameters' }).click()
  await expect(panel.getByText('No schema declared for this connector.')).toBeVisible()

  await deleteConnector(page, 'Plain Connector')
})
