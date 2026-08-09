import { test, expect } from '@playwright/test'

// Exercises docs/SPEC.md §3.7's Update: navigational/UI state (active
// view, open Composition/Configure tabs, Activity's own filters)
// persists across a reload -- the localStorage-tier half of the gap
// (window position/size is Go-side, desktop-only, not
// Playwright-testable server-mode; verified manually instead, same
// class of gap §1.3 already notes for HotkeyService). A page reload is
// the closest Playwright equivalent to an app restart for
// localStorage-backed state, since Wails' own webview uses the same
// Storage API a browser does. A workflow's own Runs tab (§7's Update --
// durable-run history/redrive moved off a standalone page into the
// workflow it belongs to) deliberately doesn't persist its Kind filter
// -- it's local component state now, simpler than replicating a
// page-level localStorage key per workflow for a minor nicety.

test('The active view persists across a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible()
})

test('An open Composition workflow tab persists across a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = page.getByTestId('workflow-row').filter({ hasText: 'Load sample HTML' })
  await row.getByRole('button', { name: /Edit/ }).click()
  await expect(page.getByRole('tab', { name: 'Load sample HTML' })).toBeVisible()

  await page.reload()
  await page.getByRole('link', { name: 'Workflows' }).click()
  // Restored into the app-wide strip (docs/SPEC.md §3.8) -- present
  // but not auto-activated; clicking it lands back in the editor.
  await expect(page.getByRole('tab', { name: 'Load sample HTML' })).toBeVisible()
  await page.getByRole('tab', { name: 'Load sample HTML' }).click()
  await expect(page.getByTestId('save-workflow')).toBeVisible()
})

test('An open Configure request view tab persists across a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  const label = 'Example: No auth (httpbin.org)'
  const row = page.getByTestId('request-row').filter({ has: page.getByText(label, { exact: true }) })
  await row.getByText(label, { exact: true }).click()
  await expect(page.getByTestId('request-summary')).toBeVisible()

  await page.reload()
  await page.getByRole('link', { name: 'Configure' }).click()
  // Restored into the app-wide strip, not auto-activated -- click it.
  await expect(page.getByRole('tab', { name: label })).toBeVisible()
  await page.getByRole('tab', { name: label }).click()
  await expect(page.getByTestId('request-summary')).toBeVisible()
  await expect(page.getByRole('heading', { name: label })).toBeVisible()
})

test('Activity source/outcome filter selections write through to localStorage', async ({ page }) => {
  await page.goto('/')

  // The filter Selects only render once there's at least one entry
  // (ActivityView.tsx: `{activity.length > 0 && (...)}`, a deliberate
  // "no controls over an empty list" choice) -- run a built-in
  // workflow first so Activity has something to filter.
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByRole('button', { name: 'Run Load sample HTML' }).click()

  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page.getByTestId('activity-row').first()).toBeVisible()

  await page.getByLabel('Filter by source').selectOption('composition')
  await page.getByLabel('Filter by outcome').selectOption('success')

  // Verified directly against localStorage, not via a reload: Activity's
  // own entry list is deliberately session-only, never persisted
  // (docs/SPEC.md §2.2's Update: "Deliberately still not persisted") --
  // a reload wipes it, so the filter Selects themselves wouldn't even
  // render post-reload (nothing to filter), independent of whether the
  // filter *value* persisted correctly. This is the honest scope: the
  // mechanism (localStorage) is what §3.7's Update actually promises,
  // not "the filter UI survives an app restart," which Activity's own
  // by-design session-only-ness makes impossible regardless.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mill-activity-source-filter'))).toBe('composition')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mill-activity-outcome-filter'))).toBe('success')

  // Reset back to 'all' so this test doesn't leak a non-default filter
  // into whatever e2e spec runs against Activity next.
  await page.getByLabel('Filter by source').selectOption('all')
  await page.getByLabel('Filter by outcome').selectOption('all')
})
