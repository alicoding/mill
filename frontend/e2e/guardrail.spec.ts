import { test, expect } from '@playwright/test'

// The guardrail execution gate end-to-end in the live app (docs/SPEC.md
// §8, ADR-0019/0022), driven through the seeded "Example:
// Approval-gated HTTP call" workflow -- the seed IS the proof
// (.claude/rules/testing.md). Every path here is deterministic: the
// deny path never lets the external HTTP call actually run, and the
// dry-run tester evaluates rules without executing anything.

const GUARDED = 'Example: Approval-gated HTTP call'

test('Running the guarded seed parks awaiting approval; deny fails it closed', async ({ page }) => {
  await page.goto('/')
  const row = page.getByTestId('workflow-row').filter({ has: page.getByText(GUARDED, { exact: true }) })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Run' }).click()

  // The run returns immediately (non-blocking start) -- open its Runs
  // tab to find it awaiting approval.
  await row.getByRole('button', { name: `Edit ${GUARDED}` }).click()
  await page.getByRole('tab', { name: 'Runs' }).click()
  await expect(page.getByTestId('run-awaiting-approval').first()).toBeVisible({ timeout: 10_000 })

  // Open the parked run: the banner names exactly what wants to run.
  await page.getByRole('button', { name: 'View' }).first().click()
  const banner = page.getByTestId('approval-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('Integration: HTTP call')

  // Deny: the run fails closed with the reason, and no approval banner
  // remains.
  await banner.getByTestId('deny-step').click()
  await expect(page.getByTestId('run-detail')).toContainText('denied by user', { timeout: 10_000 })
  await expect(page.getByTestId('approval-banner')).toHaveCount(0)
})

test('Nothing hidden: the canvas badges the guarded step and the Inspector shows its verdict', async ({ page }) => {
  await page.goto('/')
  const row = page.getByTestId('workflow-row').filter({ has: page.getByText(GUARDED, { exact: true }) })
  await row.getByRole('button', { name: `Edit ${GUARDED}` }).click()

  // The HTTP step carries a visible shield badge BEFORE any run.
  const badge = page.getByTestId('canvas-guardrail-badge')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveAttribute('data-effect', 'ask')

  // Selecting the step shows the read-only verdict -- authoring points
  // at Configure, never inline (corrected by direct discussion).
  await page.locator('[data-id="example-guarded-http"]').click()
  await expect(page.getByTestId('node-guardrail-verdict')).toHaveText('ask')
  await expect(page.getByTestId('node-guardrail-section')).toContainText('Approvals happen in Review')
})

test('Review queue: a parked human-review run accepts typed input and resumes with it', async ({ page }) => {
  await page.goto('/')
  const seed = 'Example: Human review with input'
  const row = page.getByTestId('workflow-row').filter({ has: page.getByText(seed, { exact: true }) })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Run' }).click()

  // The seed declares a 'note' Attribute, so Run opens the test-input
  // dialog (docs/adr/0008) -- clear the generated value: providing the
  // note is the REVIEWER's job in this flow.
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Note').fill('')
  await dialog.getByRole('button', { name: 'Run' }).click()

  // The run parks; the Review queue (sidebar) lists it.
  await page.getByRole('link', { name: 'Review' }).click()
  const item = page.getByTestId('review-item').filter({ hasText: seed }).first()
  await expect(item).toBeVisible({ timeout: 10_000 })
  await expect(item).toContainText('Provide a note for this run, then approve')

  // Typed input: fill the workflow's declared 'note' Attribute, approve.
  await item.getByLabel('Note').fill('e2e reviewer note')
  await item.getByTestId('review-approve').click()
  await expect(page.getByTestId('review-item').filter({ hasText: seed })).toHaveCount(0, { timeout: 10_000 })

  // The resumed run carried the input through capture-attribute and the
  // ruleset: its durable history shows SUCCESS with the note as output.
  await page.getByRole('link', { name: 'Workflows' }).click()
  await row.getByRole('button', { name: `Edit ${seed}` }).click()
  await page.getByRole('tab', { name: 'Runs' }).click()
  await page.getByRole('button', { name: 'View' }).first().click()
  await expect(page.getByTestId('run-detail')).toContainText('e2e reviewer note', { timeout: 10_000 })
})

test('Review queue: denying from the queue stops the run', async ({ page }) => {
  await page.goto('/')
  const row = page.getByTestId('workflow-row').filter({ has: page.getByText(GUARDED, { exact: true }) })
  await row.getByRole('button', { name: 'Run' }).click()

  await page.getByRole('link', { name: 'Review' }).click()
  const item = page.getByTestId('review-item').filter({ hasText: GUARDED }).first()
  await expect(item).toBeVisible({ timeout: 10_000 })
  await item.getByTestId('review-deny').click()
  await expect(page.getByTestId('review-item').filter({ hasText: GUARDED })).toHaveCount(0, { timeout: 10_000 })
})

test('Review queue shows the resolved outcome after a deny, filterable by workflow', async ({ page }) => {
  await page.goto('/')
  const row = page.getByTestId('workflow-row').filter({ has: page.getByText(GUARDED, { exact: true }) })
  await row.getByRole('button', { name: 'Run' }).click()

  await page.getByRole('link', { name: 'Review' }).click()
  const item = page.getByTestId('review-item').filter({ hasText: GUARDED }).first()
  await expect(item).toBeVisible({ timeout: 10_000 })
  await item.getByTestId('review-deny').click()

  // The denial moves to Recently resolved with its outcome labeled.
  const resolvedItem = page.getByTestId('review-resolved-item').filter({ hasText: GUARDED }).first()
  await expect(resolvedItem).toBeVisible({ timeout: 10_000 })
  await expect(resolvedItem.getByTestId('review-resolution')).toHaveText('denied')

  // The workflow filter narrows both sections.
  await page.getByLabel('Filter by workflow').selectOption({ label: 'Example: Human review with input' })
  await expect(page.getByTestId('review-resolved-item').filter({ hasText: GUARDED })).toHaveCount(0)
})

// Row drill-down (docs/goals/0002-review-queue-maturation.md item 5):
// every Review row -- pending or resolved -- opens its run in the
// app-wide work-tab shell at the workflow's Runs inner tab, with that
// run's own detail already open. Also covers the root-caused
// zero-time bug: a resolved row's timestamp must never render Go's
// zero time ("1-12-31, ...").

test('Review row drill-down: a resolved row opens its run on the Runs tab with detail preselected, and its timestamp is real', async ({ page }) => {
  await page.goto('/')
  const row = page.getByTestId('workflow-row').filter({ has: page.getByText(GUARDED, { exact: true }) })
  await row.getByRole('button', { name: 'Run' }).click()

  await page.getByRole('link', { name: 'Review' }).click()
  const item = page.getByTestId('review-item').filter({ hasText: GUARDED }).first()
  await expect(item).toBeVisible({ timeout: 10_000 })
  await item.getByTestId('review-deny').click()

  const resolvedItem = page.getByTestId('review-resolved-item').filter({ hasText: GUARDED }).first()
  await expect(resolvedItem).toBeVisible({ timeout: 10_000 })

  // The zero-time regression's exact repro string never renders, and
  // the timestamp reflects a real, current run (executionservice.go's
  // summaryFromStatus now falls back to CreatedAt when DBOS's own
  // StartedAt is zero).
  const timestampText = (await resolvedItem.textContent()) ?? ''
  expect(timestampText).not.toContain('1-12-31')
  expect(timestampText).toContain(String(new Date().getFullYear()))

  // Clicking the row itself (not a button) drills into the run: its
  // workflow's editor tab opens on the Runs inner tab, with this run's
  // own detail already open -- the ONE run-detail viewer (docs/SPEC.md
  // §7's lock), never rendered on Review itself.
  await resolvedItem.click()
  await expect(page.getByRole('tab', { name: 'Runs' })).toBeVisible()
  const detail = page.getByTestId('run-detail')
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('denied by user')
})

test('Review row drill-down: clicking a pending row opens its run too', async ({ page }) => {
  await page.goto('/')
  const row = page.getByTestId('workflow-row').filter({ has: page.getByText(GUARDED, { exact: true }) })
  await row.getByRole('button', { name: 'Run' }).click()

  await page.getByRole('link', { name: 'Review' }).click()
  const item = page.getByTestId('review-item').filter({ hasText: GUARDED }).first()
  await expect(item).toBeVisible({ timeout: 10_000 })

  // Click the row's label text (outside the stopPropagation-wrapped
  // input/button block) -- lands on the Runs tab with this still-parked
  // run's own detail (the approval banner) already open.
  await item.getByText(GUARDED, { exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Runs' })).toBeVisible()
  const detail = page.getByTestId('run-detail')
  await expect(detail).toBeVisible()
  await expect(page.getByTestId('approval-banner')).toBeVisible()

  // Clean up: deny from here so nothing stays parked for later tests.
  await page.getByTestId('deny-step').click()
  await expect(detail).toContainText('denied by user', { timeout: 10_000 })
})

test('Review row drill-down: pending-row Approve/Deny still resolve in place, without navigating', async ({ page }) => {
  await page.goto('/')
  const row = page.getByTestId('workflow-row').filter({ has: page.getByText(GUARDED, { exact: true }) })
  await row.getByRole('button', { name: 'Run' }).click()

  await page.getByRole('link', { name: 'Review' }).click()
  const item = page.getByTestId('review-item').filter({ hasText: GUARDED }).first()
  await expect(item).toBeVisible({ timeout: 10_000 })

  // The Deny button's own onClick stops propagation to the row's --
  // Review stays the active tab (no work tab opened) and the run
  // resolves in place, exactly as it did before row drill-down existed.
  await item.getByTestId('review-deny').click()
  await expect(page.getByTestId('review-view')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Runs' })).toHaveCount(0)
  await expect(page.getByTestId('review-item').filter({ hasText: GUARDED })).toHaveCount(0, { timeout: 10_000 })
})
