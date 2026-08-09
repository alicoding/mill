import { test, expect } from '@playwright/test'

// Real Go bindings over HTTP (Wails3 server mode), not mocks -- same
// setup/limitations as composition.spec.ts (see its header comment).
// Exercises the Activity feed: any run pushes here. Composition's own
// Run button is the only source clickable in a headless e2e run --
// headless trigger fires (hotkey, schedule, clipboard/filesystem-watch;
// docs/SPEC.md §3.4) can't be exercised this way at all (see
// docs/SPEC.md §1.3), so the 'trigger' source is covered by the manual
// desktop-mode check instead, not here.
//
// Renders as Primer's DataTable now (see ActivityView.tsx's header
// comment), which has no generic per-row data-testid hook -- unlike the
// old hand-rolled list, individual data rows are real <tr> elements
// inside <tbody>, addressed via table.locator('tbody tr'), not a single
// activity-row testid wrapping the whole row. The activity-row testid
// still exists, but scoped to the clickable Action cell only (see
// composition.spec.ts's canvas tests for the analogous "testid moved
// with the interactive element" pattern).

function dataRows(page: import('@playwright/test').Page) {
  return page.locator('table tbody tr')
}

// Runs both built-in workflows deterministically -- "Load sample HTML"
// first, waited-for, so its own real-HTML-onto-the-clipboard side effect
// (see its own description) is what "Clipboard → Markdown" reliably
// finds, not whatever unrelated content happened to already be on this
// machine's clipboard. Order matters: running them the other way around
// makes "Clipboard → Markdown" fail whenever nothing with an HTML flavor
// is on the clipboard, which produces a real, correctly-empty Result
// (SPEC.md's own "no successful output to show" design) but breaks any
// assertion assuming both runs produce an expandable result. Each click
// is awaited to actually finish (button text reverts from "Running…")
// before the next starts, closing the same-millisecond timestamp race
// two back-to-back async runs could otherwise hit.
async function runBothWorkflows(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: 'Workflows' }).click()

  // Waits for the full disabled -> enabled cycle, not just "enabled"
  // (which could pass immediately if checked before React ever disables
  // the button, never actually confirming the run finished).
  const loadButton = page.getByRole('button', { name: /Run Load sample HTML/ })
  await loadButton.click()
  await expect(loadButton).toBeDisabled()
  await expect(loadButton).toBeEnabled()

  const markdownButton = page.getByRole('button', { name: /Run Clipboard → Markdown/ })
  await markdownButton.click()
  await expect(markdownButton).toBeDisabled()
  await expect(markdownButton).toBeEnabled()
}

test('Running two workflows from Composition both appear in Activity', async ({ page }) => {
  await page.goto('/')

  await runBothWorkflows(page)

  await page.getByRole('link', { name: 'Activity' }).click()
  const rows = dataRows(page)
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: 'Composition' }).filter({ hasText: 'Clipboard → Markdown' })).toBeVisible()
  await expect(rows.filter({ hasText: 'Composition' }).filter({ hasText: 'Load sample HTML' })).toBeVisible()
})

test('Source and outcome filters narrow the activity list', async ({ page }) => {
  await page.goto('/')

  await runBothWorkflows(page)

  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(dataRows(page)).toHaveCount(2)

  // 'trigger' can't be produced headlessly (see header comment), so it's
  // the negative case here: filtering to it shows nothing, proving the
  // filter itself works without needing a real headless trigger fire.
  await page.getByLabel('Filter by source').selectOption('trigger')
  await expect(dataRows(page)).toHaveCount(0)

  await page.getByLabel('Filter by source').selectOption('composition')
  await expect(dataRows(page)).toHaveCount(2)

  await page.getByLabel('Filter by source').selectOption('all')
  await expect(dataRows(page)).toHaveCount(2)
})

test('Clicking an action opens its result, and multiple entries can be expanded to compare side by side', async ({ page }) => {
  await page.goto('/')

  await runBothWorkflows(page)

  await page.getByRole('link', { name: 'Activity' }).click()
  const rows = dataRows(page)
  await expect(rows).toHaveCount(2)

  // A row's Action cell is only clickable when its result is non-empty
  // (ActivityView.tsx: canExpand = entry.result !== '', which gates
  // onClick entirely -- an empty-result row renders the same testid with
  // no handler at all, so clicking it is a silent no-op, not an error).
  // Asserting "completed" here first makes that failure mode loud and
  // diagnosable (a real run failure) instead of a confusing 0-or-1
  // detail-panel count with no indication why.
  await expect(rows.nth(0)).toContainText('completed')
  await expect(rows.nth(1)).toContainText('completed')

  // Clicking each row's clickable Action cell opens its own detail panel
  // -- both stay open at once, preserving the comparison feature the old
  // hand-rolled list had (ActivityView.tsx keeps a Set of selected ids,
  // not a single one, specifically so this doesn't regress). Waits for
  // the first panel to actually mount before clicking the second row --
  // two clicks fired back-to-back with no state-backed wait between them
  // raced DataTable's own re-render, intermittently losing the first
  // toggle (confirmed by direct reproduction, not assumed: the same two
  // clicks with a real wait between them were reliable every time).
  await page.getByTestId('activity-row').nth(0).click()
  await expect(page.getByTestId('activity-detail')).toHaveCount(1)
  await page.getByTestId('activity-row').nth(1).click()
  await expect(page.getByTestId('activity-detail')).toHaveCount(2)

  await page.getByTestId('activity-detail').first().getByRole('button', { name: 'Close' }).click()
  await expect(page.getByTestId('activity-detail')).toHaveCount(1)
})

test('Activity page shows an empty state before anything has run', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page.getByText('No activity yet')).toBeVisible()
  await expect(dataRows(page)).toHaveCount(0)
})
