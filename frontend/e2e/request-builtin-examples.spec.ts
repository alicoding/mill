import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// Exercises docs/SPEC.md §4's Update: seven seeded, working example
// requests (one per real implemented AuthType) ship on first launch,
// same standing practice CompositionService.restore() already
// established for Workflows -- fully visible, editable, deletable, not
// a protected specimen. The actual live-network round trip for each
// (Postman Echo/httpbin.org) is proven manually and via the Go domain
// tests (internal/domain/composition/authstrategy_test.go,
// authoauth1.go's real signature math) -- this suite only verifies
// what's real-network-free: seeding, presence, and full deletability
// through the real UI, matching this repo's own established discipline
// of httptest.Server-only (no live third-party dependency) in the
// committed test suite.
//
// Deletes what it creates/uses is moot here -- these are pre-seeded,
// not created by this spec -- but the one test that deletes a built-in
// restores nothing afterward deliberately: the point of "delatable" is
// that it stays gone, same as any other request a user deletes.

test('Seeded example requests are present, built-in-badged, and each declares an honest Description', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  const exampleLabels = [
    'Example: No auth (httpbin.org)',
    'Example: API key header (httpbin.org)',
    'Example: Bearer token (httpbin.org)',
    'Example: HMAC signature (httpbin.org)',
    'Example: OAuth 1.0a (postman-echo.com)',
    'Example: OAuth 2.0 client credentials (Spotify Web API)',
    'Example: Query-param API key (httpbin.org)',
  ]

  for (const label of exampleLabels) {
    const row = page.locator('[data-testid="inventory-row"][data-entity="request"]').filter({ has: page.getByText(label, { exact: true }) })
    await expect(row).toBeVisible()
    await expect(row.getByText('built-in', { exact: true })).toBeVisible()
    // Every seeded example has a non-empty Description shown in the list.
    await expect(row.getByTestId('inventory-row-description')).toBeVisible()
  }
})

test('A seeded example opens its real summary view with a built-in badge and honest caveat text', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  const label = 'Example: OAuth 1.0a (postman-echo.com)'
  const row = page.locator('[data-testid="inventory-row"][data-entity="request"]').filter({ has: page.getByText(label, { exact: true }) })
  await row.getByText(label, { exact: true }).click()

  const summary = page.getByTestId('request-summary')
  await expect(summary).toBeVisible()
  await expect(summary.getByText('built-in', { exact: true })).toBeVisible()
  await expect(summary.getByText(/independently confirmed live/)).toBeVisible()
  await expect(summary.getByText('OAuth 1.0a (HMAC-SHA1)')).toBeVisible()
})

test('The OAuth2 example is honest about needing the user\'s own credentials', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  const label = 'Example: OAuth 2.0 client credentials (Spotify Web API)'
  const row = page.locator('[data-testid="inventory-row"][data-entity="request"]').filter({ has: page.getByText(label, { exact: true }) })
  await row.getByText(label, { exact: true }).click()

  const summary = page.getByTestId('request-summary')
  await expect(summary.getByText(/bring your own credentials|Register a free Spotify developer app/)).toBeVisible()
})

// Deliberately does NOT delete the seeded example itself -- that would
// permanently remove shared seed data from the e2e settings file
// (playwright.config.ts's MILL_SETTINGS_PATH persists across every
// spec file and every repeated run, .claude/rules/testing.md), which
// would break the presence-check test above on the suite's next run.
// Instead: Duplicate (an ordinary request action every request
// already has, ADR-0013 §7) proves "clone" concretely, and the
// duplicate -- not the original -- is what gets deleted, proving
// "delete" without destroying the shared fixture.
test('A seeded example can be cloned and the clone deleted, without disturbing the original', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  const label = 'Example: Query-param API key (httpbin.org)'
  const cloneLabel = `${label} copy`
  const row = page.locator('[data-testid="inventory-row"][data-entity="request"]').filter({ has: page.getByText(label, { exact: true }) })
  await expect(row).toBeVisible()

  // Editable: opens the real edit form, pre-filled, same as any
  // user-created request -- no BuiltIn-gated read-only mode.
  await row.getByText(label, { exact: true }).click()
  const summary = page.getByTestId('request-summary')
  await expect(summary).toBeVisible()
  await page.getByTestId('summary-edit').click()
  await expect(page.getByLabel('Label')).toHaveValue(label)
  await expect(page.getByLabel('Auth type')).toHaveValue('queryparam')
  await page.getByRole('button', { name: 'Cancel' }).click()

  // Clone: Duplicate (docs/adr/0014: lives on the summary view, not the
  // list row) pre-fills a new, unsaved request -- save it, confirm it
  // landed as its own real row, not built-in.
  await row.getByText(label, { exact: true }).click()
  await expect(page.getByTestId('request-summary')).toBeVisible()
  await page.getByRole('button', { name: 'Duplicate' }).click()
  await expect(page.getByLabel('Label')).toHaveValue(cloneLabel)
  await page.getByRole('button', { name: 'Save integration' }).click()

  const cloneRow = page.locator('[data-testid="inventory-row"][data-entity="request"]').filter({ has: page.getByText(cloneLabel, { exact: true }) })
  await expect(cloneRow).toBeVisible()
  await expect(cloneRow.getByText('built-in', { exact: true })).toHaveCount(0)

  // Delete the clone -- the original stays untouched.
  await clickRowAction(page, cloneRow, 'Delete')
  await expect(cloneRow).toHaveCount(0)
  await expect(row).toBeVisible()
})
