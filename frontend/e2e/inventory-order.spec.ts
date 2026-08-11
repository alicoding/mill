import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// docs/SPEC.md §3.8's InventoryList entry: every resource inventory
// default-sorts last-updated-first, not creation order or alphabetical
// -- system-managed CreatedAt/UpdatedAt on all six entities
// (Workflows, Integrations, Lists, MCP Servers, Decisions, Environments),
// stamped server-side, never trusted from the wire. Split out of
// composition.spec.ts (real seam, own header comment) once adding this
// case there crossed the 500-line limit (CLAUDE.md).
//
// Covers the Workflows list only -- every other inventory
// (Integrations/Lists/MCP Servers/Decisions/Environments) shares the
// exact same shared sortByUpdatedDesc + InventoryList wiring
// (frontend/src/shared/inventorySort.ts), already unit-tested directly
// (inventorySort.test.ts); this is the one end-to-end proof that the
// real create/edit -> save -> re-render path actually reorders a real
// page, not a second copy of the sort's own edge cases.

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

// Proven against two workflows this test itself creates (never the
// seeded built-ins, so no other spec's assumptions about seed data/
// order are disturbed), covering both the create path (a newly saved
// workflow is the newest thing) and the update path (re-saving an
// older one must move it back to the top).
test('Editing an older workflow moves it back to the top of the list, newest-updated-first', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const firstWorkflowRow = () => page.locator('[data-testid="inventory-row"][data-entity="workflow"]').first()

  // A saved first, B saved second -- B is now the most recently updated.
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByLabel('Label').fill('E2E order test A')
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(workflowRow(page, 'E2E order test A')).toBeVisible()

  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByLabel('Label').fill('E2E order test B')
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(workflowRow(page, 'E2E order test B')).toBeVisible()

  // B was saved most recently -- it must be the very first inventory row.
  await expect(firstWorkflowRow()).toContainText('E2E order test B')

  // Now edit A, the OLDER workflow -- saving it must advance its
  // UpdatedAt past B's, moving it back above B.
  const rowA = workflowRow(page, 'E2E order test A')
  await rowA.click()
  await activePanel(page).getByTestId('edit-workflow').click()
  await activePanel(page).getByLabel('Label').fill('E2E order test A (edited)')
  await activePanel(page).getByTestId('save-workflow').click()

  const editedRowA = workflowRow(page, 'E2E order test A (edited)')
  await expect(editedRowA).toBeVisible()
  await expect(firstWorkflowRow()).toContainText('E2E order test A (edited)')

  // Cleanup: within-file cleanup discipline (.claude/rules/testing.md).
  await clickRowAction(page, editedRowA, 'Delete')
  await clickRowAction(page, workflowRow(page, 'E2E order test B'), 'Delete')
  await expect(editedRowA).toHaveCount(0)
  await expect(workflowRow(page, 'E2E order test B')).toHaveCount(0)
})
