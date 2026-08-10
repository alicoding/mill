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
  await expect(page.getByTestId('node-guardrail-section')).toContainText('Configure → Guardrails')
})

test('Configure Guardrails: an allow rule flips the dry-run verdict, and deleting it restores the ask', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Guardrails' }).click()

  // Dry-run the guarded seed's HTTP step: default verdict is ask.
  const tester = page.getByTestId('configure-guardrails')
  await tester.getByLabel('Workflow').last().selectOption({ label: GUARDED })
  await tester.getByLabel('Step').last().selectOption({ index: 1 })
  await tester.getByTestId('test-guardrail-rules').click()
  await expect(page.getByTestId('guardrail-test-result')).toContainText('Require approval')

  // Create an allow rule for the integration-http node type.
  await tester.getByLabel('Name').fill('E2E allow http')
  await tester.getByLabel('Effect').selectOption('allow')
  await tester.getByLabel('Node type').selectOption({ label: 'Integration: HTTP call' })
  await tester.getByTestId('create-guardrail-rule').click()
  await expect(page.getByTestId('guardrail-rule-row').filter({ hasText: 'E2E allow http' })).toBeVisible()

  // The dry-run now reports allow, naming the rule.
  await tester.getByTestId('test-guardrail-rules').click()
  await expect(page.getByTestId('guardrail-test-result')).toContainText('Allow (skip approval)')
  await expect(page.getByTestId('guardrail-test-result')).toContainText('E2E allow http')

  // Cleanup (shared e2e store discipline): delete the rule and confirm
  // the verdict falls back to the fail-safe ask.
  await page.getByRole('button', { name: 'Delete rule E2E allow http' }).click()
  await expect(page.getByTestId('guardrail-rule-row').filter({ hasText: 'E2E allow http' })).toHaveCount(0)
  await tester.getByTestId('test-guardrail-rules').click()
  await expect(page.getByTestId('guardrail-test-result')).toContainText('Require approval')
})
