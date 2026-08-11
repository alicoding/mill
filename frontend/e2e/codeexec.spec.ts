import { test, expect } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'

// The code-execution capability end-to-end in the live app (docs/adr/0026,
// docs/SPEC.md §2.1/§6), driven through the seeded "Example: Run copied
// code" workflow -- the seed IS the proof (.claude/rules/testing.md).
// code-execution's Effect is ClassExternal, same as integration-http, so
// running it parks awaiting approval by default (docs/adr/0022) -- this
// mirrors guardrail.spec.ts's own shape for the guarded-HTTP seed.

const SEED = 'Example: Run copied code'

test('Nothing hidden: the code-execution step carries a guardrail ask badge before any run', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(SEED, { exact: true }) })
  await row.click()

  const badge = page.getByTestId('canvas-guardrail-badge')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveAttribute('data-effect', 'ask')
})

test('Run copied code: approving the code-execution step runs the real command and reaches SUCCESS', async ({ page }) => {
  // The seed's final step is a real apply-clipboard-write-text --
  // serialize through the shared clipboard lock like every other
  // real-pasteboard e2e test (.claude/rules/testing.md).
  await withClipboardLock(async () => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Workflows' }).click()
    const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(SEED, { exact: true }) })
    await expect(row).toBeVisible()
    // Exact match: the seed's own label contains the word "Run"
    // ("Example: Run copied code"), so a plain substring match on
    // "Run" also matches the row's "Actions for <label>" kebab-menu
    // button -- the Run button's real accessible name is `Run ${label}`
    // (WorkflowsTable.tsx/CompositionView.tsx), matched exactly here.
    await row.getByRole('button', { name: `Run ${SEED}`, exact: true }).click()

    // The run returns immediately (non-blocking start, docs/adr/0022) --
    // open its Runs tab to find it awaiting approval.
    await row.click()
    await page.getByRole('tab', { name: 'Runs' }).click()
    await expect(page.getByTestId('run-awaiting-approval').first()).toBeVisible({ timeout: 10_000 })

    await page.getByTestId('runs-table').locator('tbody tr').first().click()
    const banner = page.getByTestId('approval-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('Code: run command')

    // A running/parked run shows the Stop control (docs/adr/0026's
    // cancellation surfacing) -- present here even though this test
    // approves rather than cancels, proving the control itself renders
    // for an in-flight run, not just that CancelRun exists as an RPC.
    await expect(page.getByTestId('cancel-run')).toBeVisible()

    await banner.getByTestId('approve-step').click()

    // The real `echo "hello from mill"` output shows up in the run's
    // step history, and the whole run (including the real clipboard
    // write) reaches SUCCESS.
    const detail = page.getByTestId('run-detail')
    await expect(detail).toContainText('hello from mill', { timeout: 15_000 })
    await expect(detail.getByText('SUCCESS', { exact: true })).toBeVisible({ timeout: 15_000 })
  })
})
