import { test, expect } from '@playwright/test'

// Real Go bindings over HTTP (Wails3 server mode), not mocks -- same
// setup/limitations as runbook.spec.ts/composition.spec.ts (see their
// header comments). Exercises the broadened Activity feed: any run
// (Runbook direct click, Composition direct click -- hotkeys can't be
// exercised headlessly at all, see docs/SPEC.md §1.3) pushes here, not
// just hotkey fires.
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

test('Running a Runbook action and a Composition workflow both appear in Activity with distinct source badges', async ({ page }) => {
  await page.goto('/')

  // Deterministic regardless of environment (see runbook.spec.ts):
  // whatever it produces, it's a completed run either way.
  await page.getByRole('link', { name: 'Runbook' }).click()
  await page.getByRole('button', { name: /Run Clipboard → Markdown/ }).click()

  await page.getByRole('link', { name: 'Composition' }).click()
  await page.getByRole('button', { name: /Run Load sample HTML/ }).click()

  await page.getByRole('link', { name: 'Activity' }).click()
  const rows = dataRows(page)
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: 'Runbook' }).filter({ hasText: 'Clipboard → Markdown' })).toBeVisible()
  await expect(rows.filter({ hasText: 'Composition' }).filter({ hasText: 'Load sample HTML' })).toBeVisible()
})

test('Source and outcome filters narrow the activity list', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('link', { name: 'Runbook' }).click()
  await page.getByRole('button', { name: /Run Clipboard → Markdown/ }).click()

  await page.getByRole('link', { name: 'Composition' }).click()
  await page.getByRole('button', { name: /Run Load sample HTML/ }).click()

  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(dataRows(page)).toHaveCount(2)

  await page.getByLabel('Filter by source').selectOption('runbook')
  await expect(dataRows(page)).toHaveCount(1)
  await expect(dataRows(page).getByText('Runbook')).toBeVisible()

  await page.getByLabel('Filter by source').selectOption('all')
  await expect(dataRows(page)).toHaveCount(2)
})

test('Clicking an action opens its result, and multiple entries can be expanded to compare side by side', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('link', { name: 'Runbook' }).click()
  await page.getByRole('button', { name: /Run Clipboard → Markdown/ }).click()
  await page.getByRole('button', { name: /Run Load sample HTML/ }).click()

  await page.getByRole('link', { name: 'Activity' }).click()
  const rows = dataRows(page)
  await expect(rows).toHaveCount(2)

  // Clicking each row's clickable Action cell opens its own detail panel
  // -- both stay open at once, preserving the comparison feature the old
  // hand-rolled list had (ActivityView.tsx keeps a Set of selected ids,
  // not a single one, specifically so this doesn't regress).
  await page.getByTestId('activity-row').nth(0).click()
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
