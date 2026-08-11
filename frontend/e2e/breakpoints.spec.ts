import { test, expect } from './fixtures/server'

// Workflow breakpoints end to end in the live app (docs/adr/0031, goal
// 0020), driven through the seeded "Example: Branch to a decision"
// workflow -- the seed IS the proof (.claude/rules/testing.md). No
// clipboard I/O anywhere in this workflow, so no clipboard lock is
// needed (unlike composition.spec.ts's own default choice for the same
// reason).

const SEED = 'Example: Branch to a decision'
const CAPTURE_NODE = 'example-branch-capture'

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(label, { exact: true }) })
}

function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

async function openSeed(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  const row = workflowRow(page, SEED)
  await expect(row).toBeVisible()
  await row.click()
  await expect(activePanel(page).locator('.react-flow__node').first()).toBeVisible()
}

test('Toggling a breakpoint round-trips and shows the distinct debug badge before any run', async ({ page }) => {
  await openSeed(page)

  await activePanel(page).locator(`[data-id="${CAPTURE_NODE}"]`).click()
  const toggle = page.getByTestId('toggle-breakpoint')
  await expect(toggle).toHaveText('Add breakpoint')

  await toggle.click()
  await expect(toggle).toHaveText('Remove breakpoint', { timeout: 10_000 })
  await expect(page.getByTestId('breakpoint-badge')).toBeVisible()

  // The canvas's own nothing-hidden badge -- a DISTINCT icon/testid from
  // the guardrail shield, never conflated with it (docs/adr/0031 item 2).
  const debugBadge = activePanel(page).locator(`[data-id="${CAPTURE_NODE}"]`).getByTestId('canvas-debug-badge')
  await expect(debugBadge).toBeVisible({ timeout: 10_000 })
  await expect(activePanel(page).locator(`[data-id="${CAPTURE_NODE}"]`).getByTestId('canvas-guardrail-badge')).toHaveCount(0)

  // Toggling off removes both the Inspector badge and the canvas one --
  // clean up so later tests/specs don't inherit a stray breakpoint on
  // this shared seeded workflow.
  await toggle.click()
  await expect(toggle).toHaveText('Add breakpoint', { timeout: 10_000 })
  await expect(page.getByTestId('breakpoint-badge')).toHaveCount(0)
  await expect(debugBadge).toHaveCount(0, { timeout: 10_000 })
})

test('A breakpoint pauses a run with edit-and-resume; Resume continues it with the edited value', async ({ page }) => {
  await openSeed(page)

  await activePanel(page).locator(`[data-id="${CAPTURE_NODE}"]`).click()
  await page.getByTestId('toggle-breakpoint').click()
  await expect(page.getByTestId('toggle-breakpoint')).toHaveText('Remove breakpoint', { timeout: 10_000 })

  // Start with a LOW amount (would naturally reach Deny) -- the point
  // of edit-and-resume is that the value can change before it's read.
  await activePanel(page).getByTestId('canvas-run').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Amount').fill('50')
  await dialog.getByRole('button', { name: 'Run' }).click()

  const bar = activePanel(page).getByTestId('current-step-bar')
  await expect(bar).toContainText('Paused at breakpoint', { timeout: 15_000 })
  await expect(bar).toContainText('Capture')

  // Edit-and-resume (item 4): override amount to a HIGH value before
  // resuming -- the Branch node reads it fresh, after this park.
  await bar.getByLabel('Amount').fill('999')
  await bar.getByTestId('canvas-resume-step').click()

  await expect(bar).toContainText('SUCCESS', { timeout: 15_000 })
  const approveCard = activePanel(page).locator('.react-flow__node').filter({ hasText: 'Decision' }).filter({ hasText: 'DONE' }).first()
  await expect(approveCard).toBeVisible({ timeout: 10_000 })

  // Cleanup: remove the breakpoint.
  await activePanel(page).locator(`[data-id="${CAPTURE_NODE}"]`).click()
  await page.getByTestId('toggle-breakpoint').click()
  await expect(page.getByTestId('toggle-breakpoint')).toHaveText('Add breakpoint', { timeout: 10_000 })
})

test('Step mode pauses before every node; Step advances one, Continue finishes the rest', async ({ page }) => {
  await openSeed(page)

  await activePanel(page).getByTestId('canvas-run-stepped').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Amount').fill('150')
  await dialog.getByRole('button', { name: 'Run' }).click()

  const bar = activePanel(page).getByTestId('current-step-bar')
  // First park: the capture node -- no breakpoint rule needed at all in
  // step mode, proving the gate is consulted for every node regardless
  // of its effect class (the ADR's own flagged open question).
  await expect(bar).toContainText('Paused — step mode', { timeout: 15_000 })
  await expect(bar).toContainText('Capture')
  await expect(bar.getByTestId('canvas-step')).toBeVisible()

  await bar.getByTestId('canvas-step').click()
  // Parks again at the next node (the reached Decision) -- still in
  // step mode.
  await expect(bar).toContainText('Paused — step mode', { timeout: 15_000 })
  await expect(bar.getByTestId('canvas-resume-step')).toHaveText('Continue')

  await bar.getByTestId('canvas-resume-step').click()
  await expect(bar).toContainText('SUCCESS', { timeout: 15_000 })
})
