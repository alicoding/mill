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
