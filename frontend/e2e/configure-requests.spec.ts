import { test, expect } from '@playwright/test'
import { clickRowAction } from './inventoryRow'

// Exercises ADR-0007's Request OpenAPI schema (Phase 2): a Request
// can declare an OpenAPI spec at Configure time, and its declared
// operations/fields are discoverable from the read-only summary view
// (docs/adr/0014) -- the same discoverability pattern MCP Server's
// "List tools" already has (§3.6), over real Go bindings (Wails3
// server mode), not mocks.
//
// Each test deletes the request it creates at the end -- the shared
// e2e settings file (MILL_SETTINGS_PATH, playwright.config.ts) persists
// across every spec file and every repeated run, so a request left
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

// docs/adr/0014: clicking a request row opens its read-only summary
// as its own pinned tab (RequestSummary.tsx), replacing the old
// inline expand-in-place "List operations" row.
async function openRequestView(page: import('@playwright/test').Page, label: string) {
  await requestRow(page, label).getByText(label, { exact: true }).click()
  await expect(page.getByTestId('request-summary')).toBeVisible()
}

test('Creating a request with an OpenAPI spec and listing its operations', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('Sample Request')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')
  await page.getByTestId('toggle-raw-openapi').click()
  await page.getByTestId('request-openapi-spec').fill(sampleSpec)
  await page.getByRole('button', { name: 'Save request' }).click()

  const row = requestRow(page, 'Sample Request')
  await expect(row).toBeVisible()

  await openRequestView(page, 'Sample Request')
  await page.getByRole('tab', { name: 'Available attributes' }).click()
  // Primer's TabPanel keeps every panel mounted (toggles `hidden`, never
  // unmounts), and the Testing tab has its own "Operation" display too --
  // an unscoped getByText would match all three. Scope to the visible
  // tabpanel, same discipline composition e2e specs already use.
  //
  // A single declared operation auto-selects and shows as static text,
  // not a dropdown (docs/SPEC.md §3.5's "no UI for a decision that
  // doesn't exist" discipline -- a one-option Select is friction, not a
  // control).
  const attrPanel = page.getByRole('tabpanel', { name: 'Available attributes' })
  await expect(attrPanel.getByText('GET /widgets', { exact: true })).toBeVisible()

  await deleteRequest(page, 'Sample Request')
})

test('An invalid OpenAPI spec is rejected with a visible error', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('Broken Request')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')
  await page.getByTestId('toggle-raw-openapi').click()
  await page.getByTestId('request-openapi-spec').fill('not an openapi spec')
  await page.getByRole('button', { name: 'Save request' }).click()

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

test('A request persists custom headers and shows them in its Details tab', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('Header Request')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')
  await page.getByTestId('add-request-header').click()
  await page.getByTestId('request-header-key').fill('X-Client-Version')
  await page.getByTestId('request-header-value').fill('42')
  await page.getByRole('button', { name: 'Save request' }).click()

  const row = requestRow(page, 'Header Request')
  await expect(row).toBeVisible()

  await openRequestView(page, 'Header Request')
  await expect(page.getByText(/X-Client-Version: 42/)).toBeVisible()

  // Round-trips through Edit too, not just the initial Save.
  await page.getByTestId('summary-edit').click()
  await expect(page.getByTestId('request-header-key')).toHaveValue('X-Client-Version')
  await expect(page.getByTestId('request-header-value')).toHaveValue('42')
  await page.getByRole('button', { name: 'Cancel' }).click()

  await deleteRequest(page, 'Header Request')
})

test('Showing an operation\'s schema reveals its declared fields, with the secret one flagged', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('Schema Request')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')
  await page.getByTestId('toggle-raw-openapi').click()
  await page.getByTestId('request-openapi-spec').fill(schemaSpec)
  await page.getByRole('button', { name: 'Save request' }).click()

  await openRequestView(page, 'Schema Request')

  // Input parameters: the path param. Scoped to the visible tabpanel --
  // Primer's TabPanel keeps every panel mounted (toggles `hidden`, never
  // unmounts), so an unscoped getByText would match this tab's,
  // Available attributes', and Testing's own "Operation" displays.
  // A single declared operation auto-selects (no dropdown to drive).
  const inputPanel = page.getByRole('tabpanel', { name: 'Input parameters' })
  await page.getByRole('tab', { name: 'Input parameters' }).click()
  await expect(inputPanel.getByText('GET /widgets/{id}', { exact: true })).toBeVisible()
  await expect(inputPanel.getByText('id', { exact: true })).toBeVisible()

  // Available attributes: the response fields, including the
  // secret-flagged one.
  const attrPanel = page.getByRole('tabpanel', { name: 'Available attributes' })
  await page.getByRole('tab', { name: 'Available attributes' }).click()
  await expect(attrPanel.getByText('name', { exact: true })).toBeVisible()
  await expect(attrPanel.getByText('token', { exact: true })).toBeVisible()
  await expect(attrPanel.getByText('secret')).toBeVisible()

  await deleteRequest(page, 'Schema Request')
})

test('A request with no OpenAPI spec shows no declared schema', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('Plain Request')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')
  await page.getByRole('button', { name: 'Save request' }).click()

  const row = requestRow(page, 'Plain Request')
  await expect(row).toBeVisible()

  await openRequestView(page, 'Plain Request')
  const panel = page.getByRole('tabpanel', { name: 'Input parameters' })
  await page.getByRole('tab', { name: 'Input parameters' }).click()
  await expect(panel.getByText('No schema declared for this request.')).toBeVisible()

  await deleteRequest(page, 'Plain Request')
})
