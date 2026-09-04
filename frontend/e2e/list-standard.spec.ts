import { test, expect, type Page } from './fixtures/server'
import { callBindingViaRPC } from './fixtures/wailsRpc'

// The one list standard (docs/goals/0337): every list page handles
// length the same way -- one toolbar (search, sort, the page's own
// filters, the count), the user's own items paginated at a fixed 25,
// and the seeded examples in their own collapsed group at the bottom.
//
// Shared worker pool: every assertion here is scoped either to the
// workflows this file creates itself (a per-run token in every label,
// deleted at the end) or to structural chrome that exists regardless of
// what else lives on the worker's server.

const COMPOSITION_SERVICE = 'github.com/alicoding/mill/internal/services/compositionsvc.CompositionService'
const PAGE_SIZE = 25
const OVERFLOW = PAGE_SIZE + 1

function ownRows(page: Page) {
  return page.getByTestId('inventory-items').getByTestId('inventory-row')
}

function exampleRows(page: Page) {
  return page.getByTestId('inventory-examples').getByTestId('inventory-row')
}

// A workflow needs at least one step to be created at all, so every
// fixture here is a bare manual trigger -- never run, only listed.
const MANUAL_TRIGGER_NODE = { ID: 't', Kind: 'trigger', NodeTypeID: 'trigger-manual', Config: {}, Position: { X: 0, Y: 0 } }

async function createWorkflows(page: Page, token: string, count: number): Promise<string[]> {
  const ids: string[] = []
  for (let i = 1; i <= count; i++) {
    const label = `ZzList ${token} ${String(i).padStart(2, '0')}`
    const wf = await callBindingViaRPC<{ ID: string }>(
      page,
      `${COMPOSITION_SERVICE}.CreateWorkflow`,
      [label, 'One list standard fixture', [MANUAL_TRIGGER_NODE], null],
    )
    ids.push(wf.ID)
  }
  return ids
}

test('Workflows: the toolbar counts, pagination pages, and the seeded examples collapse into their own group', async ({ page }) => {
  const token = `t${Date.now().toString(36)}`
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await expect(page.getByTestId('list-toolbar')).toBeVisible()

  const ids = await createWorkflows(page, token, OVERFLOW)
  try {
    await page.reload()
    await page.getByRole('link', { name: 'Workflows' }).click()

    // Page one: a full page of the user's own items, the count as a
    // range, and numbered pagination underneath.
    await expect(ownRows(page)).toHaveCount(PAGE_SIZE)
    await expect(page.getByTestId('list-count')).toHaveText(/^1–25 of \d+$/)
    const pagination = page.getByRole('navigation', { name: 'Pagination' })
    await expect(pagination).toBeVisible()
    await expect(pagination.getByRole('link', { name: 'Page 2' })).toBeVisible()

    // The seeded examples are a separate, collapsed group at the
    // bottom -- collapsed because the user now owns items here.
    const toggle = page.getByTestId('inventory-examples-toggle')
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(exampleRows(page)).toHaveCount(0)

    // Page two carries the remainder, and only the remainder.
    await pagination.getByRole('link', { name: 'Page 2' }).click()
    await expect(ownRows(page)).toHaveCount(OVERFLOW - PAGE_SIZE)
    await expect(ownRows(page).first()).toContainText(token)
    await expect(page.getByTestId('list-count')).toHaveText(/^26–26 of \d+$/)

    // Expanding the group by hand reveals the examples in place.
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(exampleRows(page).first()).toBeVisible()
    await toggle.click()
    await expect(exampleRows(page)).toHaveCount(0)

    // A search that matches an example opens the group for as long as
    // the query stands, so a search can never appear to find nothing.
    await page.getByTestId('inventory-search').fill('Example:')
    await expect(exampleRows(page).first()).toBeVisible()
    await expect(page.getByTestId('list-count')).toHaveText(/ of \d+$/)
    await page.getByTestId('inventory-search').fill('')
    await expect(exampleRows(page)).toHaveCount(0)

    // Sorting is a menu on the toolbar, not a per-page invention.
    await page.getByTestId('list-sort').click()
    await page.getByTestId('list-sort-name').click()
    await expect(ownRows(page)).toHaveCount(PAGE_SIZE)
    await expect(ownRows(page).first()).toContainText(`ZzList ${token} 01`)
    await page.getByTestId('list-sort').click()
    await page.getByTestId('list-sort-updated').click()
  } finally {
    for (const id of ids) {
      await callBindingViaRPC(page, `${COMPOSITION_SERVICE}.DeleteWorkflow`, [id])
    }
  }

  await page.reload()
  await page.getByRole('link', { name: 'Workflows' }).click()
  await expect(page.getByText(`ZzList ${token}`, { exact: false })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Pagination' })).toHaveCount(0)
})

test('Configure: an inventory under the page size wears the same toolbar and count, with no pagination', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Integrations' }).click()

  // Configure keeps every tab's panel mounted, so each assertion is
  // scoped to the Integrations panel rather than the page.
  const panel = page.getByTestId('configure-requests')
  await expect(panel.getByTestId('list-toolbar')).toBeVisible()
  await expect(panel.getByTestId('inventory-search')).toBeVisible()
  await expect(panel.getByTestId('list-sort')).toBeVisible()
  // A list that is all examples carries no count: the Examples header
  // holds that number, and the count names the user's own items only.
  await expect(panel.getByTestId('list-count')).toHaveCount(0)
  await expect(panel.getByRole('navigation', { name: 'Pagination' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: /^Examples \(\d+\)$/ })).toBeVisible()

  await panel.getByTestId('inventory-search').fill('zzz-no-such-integration')
  await expect(panel.getByTestId('list-count')).toHaveCount(0)
  await panel.getByTestId('inventory-search').fill('')
})

test('Activity: the session feed wears the same toolbar, with its own filters as the chips', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  // One real run is what makes the session feed exist at all.
  await page.getByTestId('inventory-search').fill('Parent')
  const parentRow = page.getByTestId('inventory-row').filter({ hasText: 'Example: Parent → child call' }).first()
  await parentRow.getByRole('button', { name: /^Run Example: Parent/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.getByRole('button', { name: /^Run$/ }).click()
  await expect(page.getByTestId('workflow-run-result').locator('pre').first())
    .toContainText('processed by the child workflow', { timeout: 20000 })

  await page.getByRole('link', { name: 'Activity' }).click()
  const toolbar = page.getByTestId('list-toolbar')
  await expect(toolbar).toBeVisible()
  await expect(page.getByTestId('activity-search')).toBeVisible()
  await expect(toolbar.getByLabel('Filter by source')).toBeVisible()
  await expect(toolbar.getByLabel('Filter by outcome')).toBeVisible()
  await expect(page.getByTestId('list-count')).toHaveText(/^\d+$/)

  await page.getByTestId('activity-search').fill('zzz-no-such-run')
  await expect(page.getByTestId('list-count')).toHaveText(/^0 of \d+$/)
})
