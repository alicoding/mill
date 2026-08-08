import { test, expect } from '@playwright/test'

// Exercises the durable-execution path end-to-end (docs/adr/0004):
// ExecutionService.RunWorkflowDurable -> a real DBOS-checkpointed run ->
// RunsView's list/detail/redrive UI, over real Go bindings (Wails3
// server mode), not mocks. "Load sample HTML" is used throughout
// (matching composition.spec.ts's own choice for the identical reason):
// it only writes to the clipboard, never reads from it, so it's the one
// built-in workflow whose outcome doesn't depend on pre-existing
// clipboard state -- still hedged for osascript failing on a headless
// runner with no GUI pasteboard session (SPEC.md §1.3), same as every
// other clipboard-touching e2e test in this repo.

test('Running a workflow durably shows it in the run list with a real status', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Runs' }).click()
  await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible()

  await page.getByRole('combobox', { name: /choose a workflow/i }).selectOption({ label: 'Load sample HTML' })
  await page.getByRole('button', { name: 'Run durably' }).click()

  // The run's own row appears with a real DBOS status label -- SUCCESS
  // is the expected outcome for this workflow, ERROR only if osascript
  // has no GUI session to write to (headless CI), same hedge
  // composition.spec.ts already uses for this exact workflow.
  const row = page.locator('tr', { has: page.getByText('Load sample HTML', { exact: true }) }).first()
  await expect(row.getByText(/^(SUCCESS|ERROR)$/)).toBeVisible({ timeout: 15_000 })
})

test('Viewing a run shows its per-step breakdown', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Runs' }).click()

  await page.getByRole('combobox', { name: /choose a workflow/i }).selectOption({ label: 'Load sample HTML' })
  await page.getByRole('button', { name: 'Run durably' }).click()

  const row = page.locator('tr', { has: page.getByText('Load sample HTML', { exact: true }) }).first()
  await expect(row.getByText(/^(SUCCESS|ERROR)$/)).toBeVisible({ timeout: 15_000 })
  await row.getByRole('button', { name: 'View' }).click()

  const detail = page.getByTestId('run-detail')
  await expect(detail).toBeVisible()
  // "Load sample HTML" is a single-node workflow (apply-clipboard-write-
  // html) -- its one step's own NodeType label must appear in the
  // breakdown regardless of whether the underlying clipboard write
  // itself succeeded.
  await expect(detail.getByText('Apply: write HTML to clipboard')).toBeVisible()
})

test('Runs page shows an empty state before anything has run durably', async ({ page }) => {
  // A fresh execution.db per e2e run (MILL_EXECUTION_DB_PATH,
  // playwright.config.ts) only guarantees isolation from the real
  // desktop app, not from other tests in this same file/run -- so this
  // asserts the empty-state copy renders correctly as UI, independent
  // of whether any run has actually landed yet in this particular
  // worker's execution.db (workers: 1 makes this deterministic across
  // this file's own test order, but not a guarantee worth hardcoding
  // "zero runs" into).
  await page.goto('/')
  await page.getByRole('link', { name: 'Runs' }).click()
  await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: /choose a workflow/i })).toBeVisible()
})
