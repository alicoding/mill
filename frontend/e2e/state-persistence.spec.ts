import { test, expect } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'

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

test('An open Composition workflow tab persists across a reload, active and all (goal 0033)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ hasText: 'Load sample HTML' })
  await row.click()
  await expect(page.getByRole('tab', { name: 'Load sample HTML' })).toBeVisible()

  await page.reload()
  // Restored into the app-wide strip AND re-activated (goal 0033: a
  // real hard-reload mid-session must never cost the user their
  // place) -- no click needed, the editor is immediately visible
  // again exactly as it was before the reload. Row click opens VIEW
  // mode (docs/goals/0022), so the restored tab is a view tab too --
  // assert the canvas itself rendered (mode-agnostic), not the
  // edit-only Save button.
  await expect(page.getByRole('tab', { name: 'Load sample HTML' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('composition-canvas')).toBeVisible()
})

test('An open Configure request view tab persists across a reload, active and all (goal 0033)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  const label = 'Example: No auth (httpbin.org)'
  const row = page.locator('[data-testid="inventory-row"][data-entity="request"]').filter({ has: page.getByText(label, { exact: true }) })
  await row.getByText(label, { exact: true }).click()
  await expect(page.getByTestId('request-summary')).toBeVisible()

  await page.reload()
  // Restored into the app-wide strip AND re-activated -- no click
  // needed (goal 0033).
  await expect(page.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('request-summary')).toBeVisible()
  await expect(page.getByRole('heading', { name: label })).toBeVisible()
})

// The exact incident this goal fixes (docs/goals/0033-reload-session-
// restore.md, owner-observed live): several tabs open, a specific one
// active, a hard reload (⌘⇧R -- a real page reload is the closest
// Playwright equivalent) discarded the open tab and landed on Home
// instead. Reproduced faithfully: opening a workflow tab from a row
// click never touches `view` (shared/store.ts's openWorkTab/
// requestOpenWorkflow), so the underlying sidebar page here stays
// whatever it last was set to by an explicit nav click -- exercising
// both halves (page AND active tab) restoring correctly together, not
// just each in isolation the way the two single-tab tests above do.
test('Several open work tabs restore in order, with the SAME one active, after a reload (goal 0033)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const rowA = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ hasText: 'Load sample HTML' })
  const rowB = page.locator('[data-testid="inventory-row"][data-entity="workflow"]')
    .filter({ hasText: 'Example: Echo message (callable child)' })

  await rowA.click()
  await expect(page.getByRole('tab', { name: 'Load sample HTML' })).toHaveAttribute('aria-selected', 'true')

  // Opening rowA's tab replaced the list with its editor -- switch
  // back to the page tab (not the sidebar link, which would also
  // work but is a bigger hammer) to see the list again before
  // opening a second row.
  await page.getByRole('tab', { name: 'Workflows' }).click()
  await rowB.click()
  await expect(page.getByRole('tab', { name: 'Example: Echo message (callable child)' })).toHaveAttribute('aria-selected', 'true')
  // Opening a second tab deactivates the first, never closes it.
  await expect(page.getByRole('tab', { name: 'Load sample HTML' })).toHaveAttribute('aria-selected', 'false')

  await page.reload()

  // Both tabs are back, in the same order, and the tab that was
  // active (B) is active again -- not the page tab (which would mean
  // "landed on the section page"), and definitely not Home.
  const tabs = page.getByRole('tab')
  await expect(tabs.nth(1)).toHaveText(/Load sample HTML/)
  await expect(tabs.nth(2)).toHaveText(/Example: Echo message/)
  await expect(page.getByRole('tab', { name: 'Example: Echo message (callable child)' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'Load sample HTML' })).toHaveAttribute('aria-selected', 'false')
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toHaveCount(0)

  // The other tab still switches to cleanly -- nothing about the
  // restored activation left the strip in a broken state.
  await page.getByRole('tab', { name: 'Load sample HTML' }).click()
  await expect(page.getByRole('tab', { name: 'Load sample HTML' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'Example: Echo message (callable child)' })).toHaveAttribute('aria-selected', 'false')
})

// Regression guard for goal 0019's original concern, restated by goal
// 0033's own Acceptance: a never-been-used app (no localStorage
// snapshot at all) must still land on Home, completely unaffected by
// any of the restore machinery above.
test('A fresh boot with no persisted snapshot still lands on Home (goal 0019 regression guard)', async ({ page }) => {
  await page.goto('/')
  expect(await page.evaluate(() => localStorage.getItem('mill-app-view'))).toBeNull()
  await expect(page.getByTestId('home-view')).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(1) // just the page tab, no work tabs open
})

// Real OS clipboard I/O (goal 0009) -- "Load sample HTML" writes to it.
test('Activity source/outcome filter selections write through to localStorage', async ({ page }) => {
  await withClipboardLock(async () => {
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
})

// Build-identity badge (docs/SPEC.md §3.8): the e2e server binary and
// the bundle it serves are built from the same commit, so the STALE
// badge must be absent -- its presence here would mean the comparison
// mechanism itself is broken (a false stale alarm).
test('No stale-build badge when bundle and binary come from the same commit', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('stale-build-badge')).toHaveCount(0)
})
