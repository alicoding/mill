import { test, expect } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'
import { workflowRow } from './fixtures/canvas'
import { RUN_TERMINAL_TIMEOUT } from './fixtures/runTerminal'

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

test('Home shows a time-saved figure with its formula, a rendered chart, and a live minutes-saved edit on the most-used list', async ({ page }) => {
  await withClipboardLock(async () => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Workflows' }).click()

    const row = workflowRow(page, 'Load sample HTML')
    const runButton = row.getByRole('button', { name: 'Run' })
    await runButton.click()
    await expect(runButton).toBeEnabled({ timeout: RUN_TERMINAL_TIMEOUT })
    await runButton.click()
    await expect(runButton).toBeEnabled({ timeout: RUN_TERMINAL_TIMEOUT })

    await page.getByRole('link', { name: 'Home' }).click()
    await expect(page.getByTestId('home-view')).toBeVisible()

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

    // Average duration (goal 0051 item 1) shares ErrorRate/Series' own
    // default scope (triggered-only) -- the two runs above are both
    // manual test runs, so it starts on the same honest "nothing to
    // average yet" fallback, proven true after "include test runs" is
    // checked further down.
    const avgDurationCard = page.getByTestId('kpi-avg-duration')
    await expect(avgDurationCard).toBeVisible()
    await expect(avgDurationCard).toContainText('—')

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

    // Per-workflow duration column (item 1) and trigger-recency (item
    // 2, a workflow-level proxy, docs/goals/0051): the two runs above
    // were both manual test runs (RunKind "test"), so this row shows a
    // real average duration but the honest "never triggered" recency
    // copy, not a fabricated last-fired time.
    await expect(mostUsedRow.getByTestId('workflow-avg-duration')).toBeVisible()
    await expect(mostUsedRow.getByTestId('workflow-last-triggered')).toContainText('hasn\'t run automatically')

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
    await expect(avgDurationCard).not.toContainText('—')

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
  await expect(page.getByTestId('home-view')).toBeVisible()
})

// Goal 0051 item 2's own named acceptance target: the trigger-recency
// insight against a real seeded SCHEDULED workflow (its trigger never
// actually fires headlessly -- test runs work even while disabled, per
// its own seed description), proving the copy stays honest ("hasn't
// run automatically") rather than fabricating a last-fired time for a
// manual test run.
test('trigger recency on the seeded scheduled workflow stays honest about a manual test run not counting', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  // hasText/exact:false would also match "Example: Disabled filesystem
  // watch" (its own seed description quotes this workflow's name
  // verbatim) -- workflowRow's exact label match avoids that.
  const row = workflowRow(page, 'Example: Disabled schedule')
  const runButton = row.getByRole('button', { name: 'Run' })
  await runButton.click()
  await expect(runButton).toBeEnabled({ timeout: RUN_TERMINAL_TIMEOUT })

  await page.getByRole('link', { name: 'Home' }).click()
  const mostUsedRow = workflowRow(page, 'Example: Disabled schedule')
  await expect(mostUsedRow).toBeVisible()
  await expect(mostUsedRow.getByTestId('workflow-last-triggered')).toContainText('hasn\'t run automatically')
})
