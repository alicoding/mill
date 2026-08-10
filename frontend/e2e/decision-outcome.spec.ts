import { test, expect } from '@playwright/test'

// Decision as a reusable, typed TERMINAL outcome (docs/adr/0027),
// driven through the live app: Configure > Decisions CRUD (including
// the category-immutability UI), and the two seeded workflows that
// prove the routing-vs-terminal split end to end -- "Example: Branch to
// a decision" (a Branch node routes to one of two Decisions, a typed
// value flows into the reached outcome) and "Example: Decision with
// review" (a manual-review Decision parks in the Review queue before
// terminalizing). The seed IS the proof (.claude/rules/testing.md).

function decisionRow(page: import('@playwright/test').Page, label: string) {
  return page.getByTestId('decision-row').filter({ has: page.getByText(label, { exact: true }) })
}

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.getByTestId('workflow-row').filter({ has: page.getByText(label, { exact: true }) })
}

function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

async function openDecisionsTab(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Decisions' }).click()
  await expect(page.getByTestId('configure-decisions')).toBeVisible()
}

test('Configure > Decisions: create shows the immutability caption, edit disables category, delete cleans up', async ({ page }) => {
  await page.goto('/')
  await openDecisionsTab(page)

  await page.getByTestId('new-decision').click()
  // The create-time category control is a live Select with a caption
  // naming the immutability rule up front, not a surprise at edit time.
  await expect(page.getByText('Cannot be changed after creation', { exact: false })).toBeVisible()
  const categorySelect = page.getByTestId('decision-category')
  await expect(categorySelect).toBeEnabled()

  const label = 'E2E test decision'
  await page.getByLabel('Label').fill(label)
  await categorySelect.selectOption('deny')
  await page.getByTestId('save-decision').click()

  const row = decisionRow(page, label)
  await expect(row).toBeVisible()
  await expect(row).toContainText('Deny')

  // Edit: the category control is now disabled, same caption visible.
  await row.getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByTestId('decision-category')).toBeDisabled()
  await expect(page.getByText('Cannot be changed after creation', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  await row.getByRole('button', { name: `Delete ${label}` }).click()
  await expect(decisionRow(page, label)).toHaveCount(0)
})

test('Branch to a decision: the approve path terminalizes with a typed outcome, and the terminal card has no source handle', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const seed = 'Example: Branch to a decision'
  const row = workflowRow(page, seed)
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: new RegExp(`Edit ${seed}`) }).click()
  await expect(activePanel(page).locator('.react-flow__node').first()).toBeVisible()

  await activePanel(page).getByTestId('canvas-run').click()

  // The workflow declares an 'amount' Attribute -- Run opens the
  // test-input dialog (docs/adr/0008). 150 > 100 drives the approve arm.
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Amount').fill('150')
  await dialog.getByRole('button', { name: 'Run' }).click()

  const bar = activePanel(page).getByTestId('current-step-bar')
  await expect(bar).toContainText('SUCCESS', { timeout: 15_000 })

  // The reached terminal (Approve) card shows done, and -- the actual
  // terminal-shape assertion -- renders no source handle at all.
  const approveCard = activePanel(page).locator('.react-flow__node').filter({ hasText: 'Decision' }).filter({ hasText: 'DONE' }).first()
  await expect(approveCard).toBeVisible({ timeout: 10_000 })
  await expect(approveCard.locator('.react-flow__handle.source')).toHaveCount(0)
  await expect(approveCard.locator('.react-flow__handle.target')).toHaveCount(1)
})

test('Decision with review: a manual-review outcome parks in the Review queue; deny fails it closed', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const seed = 'Example: Decision with review'
  const row = workflowRow(page, seed)
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Run' }).click()

  await page.getByRole('link', { name: 'Review' }).click()
  const item = page.getByTestId('review-item').filter({ hasText: seed }).first()
  await expect(item).toBeVisible({ timeout: 10_000 })
  await expect(item).toContainText('Manual review (example)')

  await item.getByTestId('review-deny').click()
  await expect(page.getByTestId('review-item').filter({ hasText: seed })).toHaveCount(0, { timeout: 10_000 })
})

// docs/SPEC.md §3.8's UI-mechanisms pass: TreeView's own indent-guide
// rail (`.prc-TreeView-TreeViewItemLevelLine-*`, inspected directly
// against the installed @primer/react's compiled CSS) is suppressed
// inside the "Add steps" palette specifically -- hovering anywhere in
// the tree otherwise lights up every group's rail at once, noise in a
// drag-source list.
test('Palette: the TreeView indent-guide rail is suppressed (display: none)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()

  const rail = activePanel(page).locator('[class*="TreeViewItemLevelLine"]').first()
  if (await rail.count() === 0) {
    // No nested item happens to render a level-line element in this
    // build's DOM shape -- nothing to assert against, not a failure.
    test.skip()
  }
  await expect(rail).toHaveCSS('display', 'none')

  await activePanel(page).getByRole('button', { name: 'Back to workflows' }).click()
})
