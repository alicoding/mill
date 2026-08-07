import { test, expect } from '@playwright/test'

// Real Go bindings over HTTP (Wails3 server mode), not mocks -- same
// setup/limitations as runbook.spec.ts/composition.spec.ts (see their
// header comments). Exercises the broadened Activity feed: any run
// (Runbook direct click, Composition direct click -- hotkeys can't be
// exercised headlessly at all, see docs/SPEC.md §1.3) pushes here, not
// just hotkey fires.

test('Running a Runbook action and a Composition workflow both appear in Activity with distinct source badges', async ({ page }) => {
  await page.goto('/')

  // Deterministic regardless of environment (see runbook.spec.ts):
  // whatever it produces, it's a completed run either way.
  await page.getByRole('link', { name: 'Runbook' }).click()
  await page.getByRole('button', { name: /Run Clipboard → Markdown/ }).click()

  await page.getByRole('link', { name: 'Composition' }).click()
  await page.getByRole('button', { name: /Run Load sample HTML/ }).click()

  await page.getByRole('link', { name: 'Activity' }).click()
  const rows = page.getByTestId('activity-row')
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
  await expect(page.getByTestId('activity-row')).toHaveCount(2)

  await page.getByLabel('Filter by source').selectOption('runbook')
  await expect(page.getByTestId('activity-row')).toHaveCount(1)
  await expect(page.getByTestId('activity-row').getByText('Runbook')).toBeVisible()

  await page.getByLabel('Filter by source').selectOption('all')
  await expect(page.getByTestId('activity-row')).toHaveCount(2)
})

test('Activity page shows an empty state before anything has run', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page.getByText('No activity yet')).toBeVisible()
  await expect(page.getByTestId('activity-row')).toHaveCount(0)
})
