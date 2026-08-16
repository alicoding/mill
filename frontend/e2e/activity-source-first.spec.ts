import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import { workflowRow } from './fixtures/canvas'

// docs/SPEC.md §3.2's source-first analytics pattern on Activity
// (asked for directly): pick the input source (a workflow) and see its
// durable run history with columns driven by that workflow's own
// declared attributes, searchable by attribute value. Proven on the
// seeded parent→child pair: running the parent produces a child run
// invoked with a typed 'message' value, which then appears as a real
// column cell (and search hit) under the child's own history.

test('Selecting a source workflow shows its durable runs with attribute columns and attribute search', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  // Produce a fresh child run with a typed input value.
  const parent = workflowRow(page, 'Example: Parent → child call')
  await parent.getByRole('button', { name: 'Run Example: Parent → child call' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.getByRole('button', { name: /^Run$/ }).click()
  // A run's result renders below the InventoryList now, not inline in
  // the row itself (docs/goals/0007's dense-row anatomy has no room for
  // a result preview).
  const result = page.getByTestId('workflow-run-result').filter({ has: page.getByText('Example: Parent → child call', { exact: true }) }).locator('pre')
  await expect(result).toContainText('processed by the child workflow', { timeout: 20000 })

  await page.getByRole('link', { name: 'Activity' }).click()
  await page.getByTestId('activity-source-workflow').selectOption({ label: 'Example: Echo message (callable child)' })

  const explorer = page.getByTestId('activity-runs-explorer')
  await expect(explorer).toBeVisible()
  // The child's declared attribute drives a real column...
  await expect(explorer.getByRole('columnheader', { name: 'Message' })).toBeVisible()
  // ...whose cell carries the value this run was invoked with, plus
  // the version stamp of what executed (the parent pins v1).
  const row = explorer.getByRole('row').filter({ hasText: 'hello from the parent workflow' }).first()
  await expect(row).toBeVisible()
  await expect(row.getByText('v1', { exact: true })).toBeVisible()

  // Attribute search: a matching query keeps the row, a bogus one
  // empties the table.
  await explorer.getByTestId('runs-explorer-search').fill('hello from the parent')
  await expect(explorer.getByRole('row').filter({ hasText: 'hello from the parent workflow' }).first()).toBeVisible()
  await explorer.getByTestId('runs-explorer-search').fill('zzz-no-such-value')
  await expect(explorer.getByText('No runs match this search.')).toBeVisible()

  // Back to the live feed.
  await page.getByTestId('activity-source-workflow').selectOption('all')
  await expect(explorer).toHaveCount(0)
})

// Design-wave-1 fix #7: a workflow with zero durable run history shows
// a real Blankslate (icon + one-line invitation), the same quality bar
// Review's own empty state already has -- not a bare line of text.
// Brand-new/saved-but-never-run (same "guaranteed zero history"
// reasoning workflow-runs-panel.spec.ts's own equivalent test uses),
// not a seeded workflow, since another spec sharing this worker could
// have already produced a run against any seeded one.
test('A never-run workflow shows the Runs-explorer empty state as a Blankslate', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await page.getByLabel('Label').click()
  await page.getByLabel('Label').fill('E2E activity-explorer-empty workflow')
  await page.getByTestId('save-workflow').click()

  await page.getByRole('link', { name: 'Activity' }).click()
  await page.getByTestId('activity-source-workflow').selectOption({ label: 'E2E activity-explorer-empty workflow' })

  const explorer = page.getByTestId('activity-runs-explorer')
  await expect(explorer).toBeVisible()
  const emptyState = explorer.getByTestId('activity-runs-explorer-empty')
  await expect(emptyState).toBeVisible()
  await expect(emptyState.locator('svg')).toBeVisible()

  // Cleanup.
  await page.getByRole('link', { name: 'Workflows' }).click()
  const row = workflowRow(page, 'E2E activity-explorer-empty workflow')
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
})
