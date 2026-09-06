import { test, expect } from './fixtures/server'
import { workflowRow, activePanel } from './fixtures/canvas'
import { openInspectorTab } from './fixtures/inspectorTabs'
import { waitForRunTerminal } from './fixtures/runTerminal'

// Workflow breakpoints end to end in the live app (docs/adr/0031, goal
// 0020, moved onto the node card by goal 0022 -- docs/goals/
// 0022-workflow-view-mode.md), driven through the seeded "Example:
// Branch to a decision" workflow -- the seed IS the proof
// (.claude/rules/testing.md). No clipboard I/O anywhere in this
// workflow, so no clipboard lock is needed (unlike composition.spec.ts's
// own default choice for the same reason).
//
// Row click opens VIEW mode now (goal 0022) -- these tests deliberately
// stay in view mode throughout, since a breakpoint is a debug act, not
// an authoring edit (setting one must work without ever clicking Edit).

const SEED = 'Route an expense by amount'
const CAPTURE_NODE = 'example-branch-capture'

function captureNode(page: import('@playwright/test').Page) {
  return activePanel(page).locator(`[data-id="${CAPTURE_NODE}"]`)
}

function breakpointToggle(page: import('@playwright/test').Page) {
  return captureNode(page).getByTestId('canvas-breakpoint-toggle')
}

async function openSeed(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  const row = workflowRow(page, SEED)
  await expect(row).toBeVisible()
  await row.click()
  await expect(activePanel(page).locator('.react-flow__node').first()).toBeVisible()
}

test('Toggling a breakpoint from the node card round-trips in VIEW mode, shows the distinct debug state, and the Inspector stays read-only', async ({ page }) => {
  await openSeed(page)

  // No Edit click anywhere in this test -- the card's own dot works
  // in view mode (docs/goals/0022: "setting a breakpoint is a debug
  // act, not an editing act").
  await expect(page.getByTestId('edit-workflow')).toBeVisible()
  await expect(page.getByTestId('save-workflow')).toHaveCount(0)

  const toggle = breakpointToggle(page)
  await expect(toggle).toHaveAttribute('data-set', 'false')

  await toggle.click()
  await expect(toggle).toHaveAttribute('data-set', 'true', { timeout: 10_000 })

  // Selecting the node afterward shows the SAME state on the Inspector's
  // Settings tab -- tier 2, never between the step's parameters (goal
  // 0327). The card's dot stays the primary control; the tab's own
  // toggle runs the same context call.
  await captureNode(page).click()
  const inspector = page.getByTestId('composition-inspector')
  await expect(inspector.getByTestId('breakpoint-badge')).toHaveCount(0)
  await openInspectorTab(inspector, 'settings')
  await expect(page.getByTestId('breakpoint-badge')).toBeVisible()
  await expect(page.getByTestId('breakpoint-status')).toContainText('Breakpoint set')

  // The guardrail shield is suppressed while the breakpoint IS the
  // winning verdict (docs/adr/0031: "recognition, not confirmation" --
  // the two must never read as one concept).
  await expect(captureNode(page).getByTestId('canvas-guardrail-badge')).toHaveCount(0)

  // Toggling off (still from the card) removes both the Inspector
  // status and the toggle's own set state -- clean up so later
  // tests/specs don't inherit a stray breakpoint on this shared seeded
  // workflow.
  await toggle.click()
  await expect(toggle).toHaveAttribute('data-set', 'false', { timeout: 10_000 })
  await expect(page.getByTestId('breakpoint-badge')).toHaveCount(0)
})

test('A breakpoint pauses a run with edit-and-resume; Resume continues it with the edited value', async ({ page }) => {
  await openSeed(page)

  await breakpointToggle(page).click()
  await expect(breakpointToggle(page)).toHaveAttribute('data-set', 'true', { timeout: 10_000 })

  // Start with a LOW amount (would naturally reach Deny) -- the point
  // of edit-and-resume is that the value can change before it's read.
  await activePanel(page).getByTestId('canvas-run').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Amount').fill('50')
  await dialog.getByRole('button', { name: 'Run' }).click()

  const bar = activePanel(page).getByTestId('run-state-dock')
  await waitForRunTerminal(bar, 'Paused at breakpoint: Read attribute')
  // A breakpoint has nowhere to step to, so it offers Resume and Stop only.
  await expect(bar.getByRole('button')).toHaveText(['Resume', 'Stop'])

  // Edit-and-resume (item 4): override amount to a HIGH value before
  // resuming -- the Branch node reads it fresh, after this park.
  await bar.getByLabel('Amount').fill('999')
  await bar.getByTestId('canvas-resume-step').click()

  await waitForRunTerminal(bar)
  const approveCard = activePanel(page).locator('.react-flow__node').filter({ hasText: 'Decision' }).filter({ hasText: 'DONE' }).first()
  await expect(approveCard).toBeVisible({ timeout: 10_000 })

  // Cleanup: remove the breakpoint.
  await breakpointToggle(page).click()
  await expect(breakpointToggle(page)).toHaveAttribute('data-set', 'false', { timeout: 10_000 })
})

test('Step mode pauses before every node; Step advances one, Continue finishes the rest', async ({ page }) => {
  await openSeed(page)

  await activePanel(page).getByTestId('canvas-run-menu').click()
  await page.getByTestId('canvas-run-stepped').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Amount').fill('150')
  await dialog.getByRole('button', { name: 'Run' }).click()

  const bar = activePanel(page).getByTestId('run-state-dock')
  // First park: the capture node -- no breakpoint rule needed at all in
  // step mode, proving the gate is consulted for every node regardless
  // of its effect class (the ADR's own flagged open question).
  await waitForRunTerminal(bar, 'Paused at Read attribute')
  await expect(bar.getByTestId('canvas-step')).toBeVisible()
  // Continue comes first, Step second, Stop last -- the debugger order
  // (goal 0328), so the button under the pointer never depends on how
  // the run happened to stop.
  await expect(bar.getByRole('button')).toHaveText(['Continue', 'Step', 'Stop'])
  // The paused node wears the accent ring, not just its status tag.
  await expect(captureNode(page).locator('[data-run-paused="true"]')).toHaveCount(1)

  await bar.getByTestId('canvas-step').click()
  // Parks again at the next node (the reached Decision) -- still in
  // step mode.
  await waitForRunTerminal(bar, /Paused at /)
  await expect(bar).not.toContainText('Read attribute')
  await expect(bar.getByTestId('canvas-resume-step')).toHaveText('Continue')

  await bar.getByTestId('canvas-resume-step').click()
  await waitForRunTerminal(bar)
})
