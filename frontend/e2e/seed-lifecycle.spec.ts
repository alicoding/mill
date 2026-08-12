import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// docs/goals/0037's minimal e2e coverage: the reset-to-shipped-example
// affordance (item 4) and the restore-deleted-example affordance (item
// 5), both against real Go bindings over HTTP (server mode), same
// setup as composition.spec.ts. Backend reconcile/latch/reset/restore
// mechanics already have thorough Go coverage
// (compositionservice_seedlifecycle_test.go/configureservice_
// seedlifecycle_test.go) -- this file only proves the UI actually
// surfaces the right affordance at the right time, per testing.md's
// "e2e: minimal" scoping for this goal.
//
// Both tests fully restore the workflow they touch by their own end
// (reset back to shipped / re-restored), so the shared built-in
// fixtures other composition specs in this suite depend on
// ("Load sample HTML" et al.) stay pristine regardless of worker
// scheduling order (testing.md's within-file/within-worker cleanup
// discipline).

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

test('Reset-to-shipped-example: hidden until modified, then restores the golden content', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Load sample HTML')
  await expect(row).toBeVisible()

  // Up to date with shipped: no Reset item in the menu at all (hidden,
  // not shown-disabled -- docs/goals/0037 item 4's own allowance,
  // InventoryMenuAction has no disabled concept). Checked, then the
  // page is reloaded before the Edit flow below -- rather than closing
  // this same ActionMenu and immediately reopening it on the same row
  // (flaky: Primer's overlay can still be settling its own focus/
  // portal teardown), a fresh navigation is the same reliable "closed"
  // starting state every other test in this file/composition.spec.ts
  // already begins from.
  await row.getByTestId('inventory-row-menu').click()
  await expect(page.getByRole('menuitem', { name: /Reset to shipped example/ })).toHaveCount(0)
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await expect(row).toBeVisible()

  // Any real edit latches Modified (docs/goals/0037 item 2) -- a plain
  // label change is enough, no canvas/node interaction needed.
  await clickRowAction(page, row, 'Edit')
  await expect(page.getByTestId('save-workflow')).toHaveText('Save changes')
  await page.getByLabel('Label').fill('Load sample HTML (e2e-modified)')
  await page.getByTestId('save-workflow').click()
  await page.getByRole('tab', { name: 'Workflows' }).click()

  const modifiedRow = workflowRow(page, 'Load sample HTML (e2e-modified)')
  await expect(modifiedRow).toBeVisible()
  await modifiedRow.getByTestId('inventory-row-menu').click()
  const resetItem = page.getByRole('menuitem', { name: 'Reset to shipped example v1' })
  await expect(resetItem).toBeVisible()
  await resetItem.click()

  // Resetting restores the golden's original label -- non-destructive
  // (a new published version, per ADR-0021 -- not asserted here, the
  // history-preservation half is Go-tested), and the fixture other
  // specs depend on is exactly as it was before this test ran.
  await expect(workflowRow(page, 'Load sample HTML')).toBeVisible()
  await expect(workflowRow(page, 'Load sample HTML (e2e-modified)')).toHaveCount(0)
})

test('Restore-example: a deleted built-in reappears via the header menu', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  // A built-in not used as a shared fixture by any other composition
  // spec in this suite -- safe to delete/restore in isolation.
  const label = 'Example: Clipboard inspector'
  const row = workflowRow(page, label)
  await expect(row).toBeVisible()

  // Nothing tombstoned yet: the header's restore menu doesn't even
  // render (docs/goals/0037 item 5: "appears only when applicable").
  await expect(page.getByTestId('restore-examples-menu')).toHaveCount(0)

  await clickRowAction(page, row, 'Delete')
  await expect(workflowRow(page, label)).toHaveCount(0)

  const restoreMenu = page.getByTestId('restore-examples-menu')
  await expect(restoreMenu).toBeVisible()
  await restoreMenu.click()
  await page.getByRole('menuitem', { name: label }).click()

  await expect(workflowRow(page, label)).toBeVisible()
  await expect(page.getByTestId('restore-examples-menu')).toHaveCount(0)
})
