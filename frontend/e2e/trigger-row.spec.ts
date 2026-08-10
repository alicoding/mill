import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// Exercises docs/goals/0006-trigger-aware-workflows-list.md: each
// Workflows-list row derives its label + affordance from its trigger
// (root) node, over real Go bindings (Wails3 server mode), not mocks --
// same setup as composition.spec.ts. Real OS hotkey registration
// (internal/adapters/hotkey) is stubbed out entirely under the `server`
// build tag (hotkey_server.go, see settings.spec.ts's own header
// comment), so the hotkey coverage here only asserts the deterministic,
// environment-independent path: the inline capture UI appearing and
// Escape cancelling it -- never a real OS-level bind.

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

test('A manual-trigger row shows "Manual" and an honest test-run tooltip', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Load sample HTML')
  const trigger = row.getByTestId('trigger-row-label')
  await expect(trigger).toHaveText('Manual')
  await expect(trigger).toHaveAttribute('data-trigger-type', 'trigger-manual')

  // Regex, not an exact match: whether this reads "Test run of the
  // draft." or the drift-flagged variant depends on this seeded
  // workflow's own publish state, which this spec doesn't own -- both
  // are honest, neither is "Run" pretending to be something it isn't.
  await expect(row.getByRole('button', { name: 'Run' })).toHaveAttribute('title', /Test run of the draft/)
})

test('The callable seeded workflow demotes Run to a secondary Test action', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  // Doesn't delete this seed -- other specs (docs/adr/0010's own
  // parent/child coverage) depend on it still existing.
  const row = workflowRow(page, 'Example: Echo message (callable child)')
  await expect(row).toBeVisible()

  const trigger = row.getByTestId('trigger-row-label')
  await expect(trigger).toHaveText('Run by another workflow')
  await expect(trigger).toHaveAttribute('data-trigger-type', 'trigger-callable')

  // No primary Run button at all -- the exact incoherence the goal
  // names ("only runnable by another workflow" and still showing Run).
  await expect(row.getByRole('button', { name: 'Run' })).toHaveCount(0)
  const testButton = row.getByTestId('callable-test-run')
  await expect(testButton).toBeVisible()
  await expect(testButton).toHaveAttribute('title', /Test run of the draft/)
})

test('A schedule trigger row shows the humanized cron, is not-live before Publish, and arms after it', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()

  const nodes = activePanel(page).locator('.react-flow__node')
  await nodes.first().click()
  await activePanel(page).getByTestId('change-node-type').selectOption('trigger-schedule')

  const cronField = activePanel(page).getByTestId('canvas-config-field')
  await cronField.fill('0 9 * * *')
  await cronField.blur()

  await activePanel(page).getByLabel('Label').fill('E2E schedule trigger row')
  await activePanel(page).getByTestId('save-workflow').click()

  const row = workflowRow(page, 'E2E schedule trigger row')
  await expect(row).toBeVisible()

  const trigger = row.getByTestId('trigger-row-label')
  await expect(trigger).toHaveAttribute('data-trigger-type', 'trigger-schedule')
  await expect(trigger).toContainText(/9:00 ?AM/i)
  await expect(trigger).toContainText('not live')

  // Publishing is what's actually blocking the trigger from arming
  // (TriggerService.Sync's own gate) -- clicking it here is the same
  // CompositionService.PublishWorkflow call WorkflowVersionsPanel.tsx's
  // "Publish current draft" button makes, just reachable from the row.
  const publishButton = row.getByTestId('trigger-row-publish')
  await expect(publishButton).toBeVisible()
  await publishButton.click()

  await expect(trigger).toContainText('armed')
  await expect(row.getByTestId('trigger-row-publish')).toHaveCount(0)

  await clickRowAction(page, row, 'Delete')
  await expect(workflowRow(page, 'E2E schedule trigger row')).toHaveCount(0)
})

test('A hotkey trigger row offers inline "Add hotkey…" capture, cancelable with Escape', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()

  const nodes = activePanel(page).locator('.react-flow__node')
  await nodes.first().click()
  await activePanel(page).getByTestId('change-node-type').selectOption('trigger-hotkey')

  await activePanel(page).getByLabel('Label').fill('E2E hotkey trigger row')
  await activePanel(page).getByTestId('save-workflow').click()

  const row = workflowRow(page, 'E2E hotkey trigger row')
  await expect(row).toBeVisible()

  const trigger = row.getByTestId('trigger-row-label')
  await expect(trigger).toHaveAttribute('data-trigger-type', 'trigger-hotkey')
  const addHotkey = row.getByTestId('row-add-hotkey')
  await expect(addHotkey).toBeVisible()

  await addHotkey.click()
  await expect(row.getByText(/press a combo/i)).toBeVisible()

  // Escape cancels recording without ever calling AssignHotkey --
  // deterministic regardless of server-mode's real hotkey stub, same
  // pattern settings.spec.ts's summon-hotkey test already established.
  await page.keyboard.press('Escape')
  await expect(row.getByText(/press a combo/i)).not.toBeVisible()
  await expect(row.getByTestId('row-add-hotkey')).toBeVisible()

  await clickRowAction(page, row, 'Delete')
  await expect(workflowRow(page, 'E2E hotkey trigger row')).toHaveCount(0)
})
