import { expect, type Page } from '@playwright/test'
import { workflowRow } from './canvas'

// Shared by browser-replay.spec.ts and browser-extension-mv3.spec.ts
// (testing.md: an interaction helper used by 2+ files MUST be
// promoted) -- driving the seeded "Example: Replay a browser flow"
// workflow from its row through to a parked approval, the same two
// steps both specs need regardless of which browser half (the fake
// wire-protocol stand-in, or a real unpacked extension) answers it.

// SEEDED is the workflow's own name, the one row both specs look up.
export const SEEDED = 'Example: Replay a browser flow'

// Starts the seeded workflow from the Workflows list, filling this
// run's two declared Attributes, and lands on its own Runs tab.
export async function runSeededWorkflow(page: Page, pageURL: string, typedText: string): Promise<void> {
  await page.getByRole('link', { name: 'Workflows' }).click()
  const row = workflowRow(page, SEEDED)
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Run' }).click()

  // A workflow with declared Attributes asks for this run's values
  // before it starts.
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Page address').fill(pageURL)
  await dialog.getByLabel('Text to type').fill(typedText)
  await dialog.getByRole('button', { name: 'Run', exact: true }).click()

  // Saving closed the editor tab, so the workflow is opened again from
  // its row to reach its own Runs tab.
  await row.click()
  await page.getByRole('tab', { name: 'Runs' }).click()
}

// Opens the newest parked run and approves its browser step.
export async function approveTheParkedRun(page: Page): Promise<void> {
  await expect(page.getByTestId('run-awaiting-approval').first()).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('runs-table').locator('tbody tr').first().click()
  const banner = page.getByTestId('approval-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('Replay in the browser')
  await banner.getByTestId('approve-step').click()
  // The run resumes asynchronously; nothing downstream is true until the
  // approval banner is gone.
  await expect(page.getByTestId('approval-banner')).toHaveCount(0, { timeout: 60_000 })
}
