import { test, expect } from './fixtures/server'
import { workflowRow, activePanel } from './fixtures/canvas'
import { openInspectorTab } from './fixtures/inspectorTabs'

// The step inspector's three tiers (goal 0327): Parameters open on
// selection and carrying nothing but the step's own setup, Settings one
// click away with Approval / Rules / Breakpoint, Test holding the
// try-it surface and the selected run's data, and a footer stating the
// I/O contract under every tab.
//
// Driven through the seeded "Example: Branch to a decision" workflow --
// the seed IS the proof (.claude/rules/testing.md). No clipboard, no
// network: every step is a local read or a routing decision, so this
// runs on the SHARED worker pool and asserts only on the steps it
// selects, cleaning up the one breakpoint it sets.

const SEED = 'Example: Branch to a decision'
const TRIGGER_NODE = 'example-branch-trigger'
const CAPTURE_NODE = 'example-branch-capture'

async function openSeed(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  const row = workflowRow(page, SEED)
  await expect(row).toBeVisible()
  await row.click()
  await expect(activePanel(page).locator('.react-flow__node').first()).toBeVisible()
}

function node(page: import('@playwright/test').Page, id: string) {
  return activePanel(page).locator(`[data-id="${id}"]`)
}

function inspector(page: import('@playwright/test').Page) {
  return page.getByTestId('composition-inspector')
}

test('a trigger with no setup opens on Parameters saying so, keeps behaviour on Settings, and is offered no Test tab', async ({ page }) => {
  await openSeed(page)
  await node(page, TRIGGER_NODE).click()

  const panel = inspector(page)
  // Tier 1 alone on open: the one line that says there is nothing to set.
  await expect(panel).toContainText('This step needs no setup.')
  // Debugging state is never a field between parameters.
  await expect(panel.getByTestId('breakpoint-status')).toHaveCount(0)
  await expect(panel.getByTestId('node-guardrail-rules-heading')).toHaveCount(0)
  // A trigger has no input to try, and no run has recorded data for it.
  await expect(panel.getByTestId('inspector-tab-test')).toHaveCount(0)

  // Tier 3 sits under every tab.
  await expect(panel.getByTestId('inspector-io-contract')).toContainText('Takes ')
  await expect(panel.getByTestId('inspector-io-contract')).toContainText(' · Produces ')
  await expect(panel.getByTestId('inspector-docs-link')).toBeVisible()

  await openInspectorTab(panel, 'settings')
  await expect(panel.getByTestId('breakpoint-status')).toBeVisible()
  await expect(panel.getByTestId('inspector-io-contract')).toBeVisible()
})

test('a step with setup shows its fields on Parameters, its three behaviour groups on Settings, and Try this step on Test', async ({ page }) => {
  await openSeed(page)
  await node(page, CAPTURE_NODE).click()

  const panel = inspector(page)
  await expect(panel.getByTestId('canvas-config-field').first()).toBeVisible()
  await expect(panel).not.toContainText('This step needs no setup.')
  await expect(panel.getByTestId('node-guardrail-section')).toHaveCount(0)

  await openInspectorTab(panel, 'settings')
  await expect(panel).toContainText('Approval')
  await expect(panel.getByTestId('node-guardrail-verdict')).toBeVisible()
  await expect(panel.getByTestId('node-guardrail-rules-heading')).toBeVisible()
  await expect(panel.getByTestId('node-breakpoint-section')).toBeVisible()
  // Parameters are gone while behaviour is showing -- one tier at a time.
  await expect(panel.getByTestId('canvas-config-field')).toHaveCount(0)

  await openInspectorTab(panel, 'test')
  await expect(panel.getByTestId('step-test-section')).toBeVisible()
  await expect(panel).toContainText('Try this step')
  await expect(panel.getByTestId('inspector-io-contract')).toBeVisible()
})

test('a breakpoint set from the node card marks the Settings tab, and the tab\'s own toggle clears it', async ({ page }) => {
  await openSeed(page)

  const dot = node(page, CAPTURE_NODE).getByTestId('canvas-breakpoint-toggle')
  await expect(dot).toHaveAttribute('data-set', 'false')
  await dot.click()
  await expect(dot).toHaveAttribute('data-set', 'true', { timeout: 10_000 })

  await node(page, CAPTURE_NODE).click()
  const panel = inspector(page)
  const settingsTab = panel.getByTestId('inspector-tab-settings')
  await expect(settingsTab).toHaveAttribute('data-breakpoint', 'true', { timeout: 10_000 })

  await openInspectorTab(panel, 'settings')
  await expect(panel.getByTestId('breakpoint-status')).toContainText('Breakpoint set')
  await panel.getByTestId('inspector-breakpoint-toggle').click()

  await expect(panel.getByTestId('breakpoint-status')).toContainText('No breakpoint', { timeout: 10_000 })
  await expect(settingsTab).toHaveAttribute('data-breakpoint', 'false')
  await expect(dot).toHaveAttribute('data-set', 'false', { timeout: 10_000 })
})

test('a recorded run counts on the Test tab, which holds that run\'s step data', async ({ page }) => {
  await openSeed(page)

  const panel = activePanel(page)
  await panel.getByTestId('canvas-run').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Amount').fill('150')
  await dialog.getByRole('button', { name: 'Run' }).click()
  await expect(panel.getByTestId('run-state-dock')).toContainText('SUCCESS', { timeout: 15_000 })

  await node(page, CAPTURE_NODE).click()
  const sidebar = inspector(page)
  await expect(sidebar.getByTestId('inspector-tab-test')).toContainText('1', { timeout: 10_000 })

  await openInspectorTab(sidebar, 'test')
  await expect(sidebar.getByTestId('node-execution-section')).toBeVisible()
  await expect(sidebar).toContainText("This run's step data")
})
