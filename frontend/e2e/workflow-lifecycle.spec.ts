import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import { workflowRow } from './fixtures/canvas'

// docs/adr/0021 end to end over real Go bindings: a new workflow is a
// draft until published; Publish/Make-live/Disable all happen on the
// editor's Versions tab; the list badges reflect lifecycle state.

test('A workflow is a draft until published; publish, disable, and re-enable all round-trip', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  await page.getByTestId('new-workflow').click()
  await page.locator('[role="tabpanel"]:not([hidden])').last().getByLabel('Label').fill('Lifecycle e2e workflow')
  await page.locator('[role="tabpanel"]:not([hidden])').last().getByTestId('save-workflow').click()

  const row = workflowRow(page, 'Lifecycle e2e workflow')
  await expect(row).toBeVisible()
  await expect(row.getByText('draft', { exact: true })).toBeVisible()

  // Open the editor (row click, InventoryList's onOpen) -> Versions tab
  // -> publish the draft.
  await row.click()
  await page.getByRole('tab', { name: 'Versions' }).click()
  const panel = page.getByTestId('workflow-versions-panel')
  await expect(panel.getByTestId('published-badge')).toHaveText('never published')
  await panel.getByTestId('publish-workflow').click()
  await expect(panel.getByTestId('published-badge')).toHaveText('v1 live')

  // Disable pauses production; the badge appears in the panel and on
  // the list row. Re-enable clears it.
  await panel.getByTestId('toggle-disabled').click()
  await expect(panel.getByTestId('disabled-badge')).toBeVisible()
  await page.getByRole('tab', { name: 'Workflows' }).click()
  await expect(row.getByText('v1 live', { exact: true })).toBeVisible()
  await expect(row.getByText('disabled', { exact: true })).toBeVisible()

  await row.click()
  await page.getByRole('tab', { name: 'Versions' }).click()
  await panel.getByTestId('toggle-disabled').click()
  await expect(panel.getByTestId('disabled-badge')).toHaveCount(0)

  // Cleanup (shared e2e settings file, .claude/rules/testing.md).
  await page.getByRole('tab', { name: 'Workflows' }).click()
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
})

test('The seeded parent pinned to the child v1 runs v1 even though the child draft differs', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  // The seeded pair reaches this long-lived e2e settings file via
  // top-up seeding -- itself part of what this proves.
  const parent = workflowRow(page, 'Example: Parent → child call')
  await expect(parent).toBeVisible()

  await parent.getByRole('button', { name: 'Run Example: Parent → child call' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.getByRole('button', { name: /^Run$/ }).click()

  // v1's marker, never the draft's -- the pin holds (ADR-0021). The
  // result renders below the InventoryList now, not inline in the row
  // (docs/goals/0007's dense-row anatomy has no room for a result
  // preview).
  const result = page.getByTestId('workflow-run-result').filter({ has: page.getByText('Example: Parent → child call', { exact: true }) }).locator('pre')
  await expect(result).toContainText('(processed by the child workflow, v1)', { timeout: 20000 })
  await expect(result).not.toContainText('DRAFT')
})
