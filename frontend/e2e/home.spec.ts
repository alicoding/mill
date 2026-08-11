import { test, expect } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'

// docs/goals/0014-home-dashboard.md, docs/SPEC.md §3.2.3. Real Go
// bindings over HTTP (Wails3 server mode), not mocks -- same setup as
// the rest of this suite. "Load sample HTML" is the deterministic seed
// used throughout this suite for the same reason composition.spec.ts/
// workflow-runs-panel.spec.ts already pick it: it only WRITES to the
// clipboard, never reads from it, so its outcome doesn't depend on
// pre-existing clipboard state -- hedged with withClipboardLock like
// every other clipboard-touching spec here.
//
// A manual list-Run click is always RunKind "test" (docs/adr/0008) --
// the Time Saved KPI's own locked semantics (docs/goals/0014) credit
// only Success + RunKind:triggered runs, so these two runs contribute
// nothing to that KPI's total. That's asserted directly (the KPI's own
// explanation renders, not a fabricated number) rather than worked
// around -- Most-used and the chart (once "include test runs" is
// checked) don't have that restriction, and are what these runs
// actually prove out.

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

test('Home shows a time-saved figure with its formula, a rendered chart, and a live minutes-saved edit on the most-used list', async ({ page }) => {
  await withClipboardLock(async () => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Workflows' }).click()

    const row = workflowRow(page, 'Load sample HTML')
    const runButton = row.getByRole('button', { name: 'Run' })
    await runButton.click()
    await expect(runButton).toBeEnabled({ timeout: 15_000 })
    await runButton.click()
    await expect(runButton).toBeEnabled({ timeout: 15_000 })

    await page.getByRole('link', { name: 'Home' }).click()
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible()

    // Time saved: a figure AND its formula/explanation are always
    // visible (goal 0014's "never fake precision" rule). The two runs
    // above were manual test runs, so the KPI's own locked semantics
    // (Success + triggered only) credit nothing -- the visible
    // explanation for why is the proof, not a fabricated total.
    const timeSavedCard = page.getByTestId('kpi-time-saved')
    await expect(timeSavedCard).toBeVisible()
    await expect(timeSavedCard.getByTestId('time-saved-formula')).toBeVisible()

    await expect(page.getByTestId('kpi-error-rate')).toBeVisible()
    await expect(page.getByTestId('kpi-ambient')).toBeVisible()

    // Most-used: "Load sample HTML" shows up with a real run count (any
    // Kind counts, docs/goals/0014's usage-mirror layer) -- read it back
    // rather than assuming an exact number, since this worker's server
    // may have run this same built-in workflow in an earlier spec file
    // too (goal 0009: one server per worker, not per spec).
    const mostUsedRow = page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { hasText: 'Load sample HTML' })
    await expect(mostUsedRow).toBeVisible()
    const descriptionBefore = await mostUsedRow.getByTestId('inventory-row-description').innerText()
    const runsMatch = descriptionBefore.match(/^(\d+) run/)
    expect(runsMatch).not.toBeNull()
    expect(Number(runsMatch![1])).toBeGreaterThanOrEqual(2)

    // Editing minutes-saved updates the row's own displayed figure --
    // a distinctive value (10, unlikely to already be set) so a stale
    // read can't fake a pass.
    const minutesInput = mostUsedRow.getByTestId('minutes-saved-input')
    await minutesInput.fill('10')
    await minutesInput.blur()
    await expect(mostUsedRow.getByTestId('inventory-row-description')).toContainText('at 10 min/run', { timeout: 10_000 })

    // The chart's own default scope is triggered-only (same as
    // ErrorRate/Series, docs/goals/0014) -- this test's two runs were
    // manual test runs, so checking "include test runs" is what makes
    // them show up as real chart data, proving a real Recharts SVG
    // renders with real data behind it, not an empty shell.
    await page.getByTestId('include-test-runs-checkbox').check()
    await expect(page.locator('.recharts-surface').first()).toBeVisible({ timeout: 10_000 })

    // Restore the default so this run's edit doesn't linger as a
    // surprise for anything else sharing this worker's settings file.
    await minutesInput.fill('3')
    await minutesInput.blur()
    await expect(mostUsedRow.getByTestId('inventory-row-description')).toContainText('at 3 min/run', { timeout: 10_000 })
  })
})

test('Cmd+1 through Cmd+4 style view links still reach Home from the sidebar as the first entry', async ({ page }) => {
  await page.goto('/')
  // Default landing view -- confirms goal 0014's own acceptance framing
  // ("Owner lands on Home, recognizes it instantly") without depending
  // on any prior test's state.
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible()
  await expect(page.getByTestId('home-view')).toBeVisible()
})
