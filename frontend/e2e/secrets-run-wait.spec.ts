import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnMillServer, type SpawnedServer } from './fixtures/server'
import { SECRETS_RUN_WAIT_MCP_BASE_PORT, SECRETS_RUN_WAIT_SERVER_BASE_PORT } from './fixtures/serverPorts'

// A run that needs a secret while the vault is locked waits for the
// vault (goal 0360 S2): the seeded "Example: Scheduled read of a
// secret" run by hand with the vault locked lands in Review as
// "Waiting for the vault to unlock", the sidebar counts it, Unlock
// vault on the card resumes it, and the card resolves. Dedicated
// server pair (fixtures/serverPorts.ts): the vault's lock state and the
// Review queue are global app state.
//
// The seeded step calls a public echo service; whether that call
// succeeds is that service's business, not this suite's, so after the
// unlock the assertion is that the run stopped waiting (it left Review
// and its step reached a terminal state), not that the echo answered.

const WORKFLOW = 'Example: Scheduled read of a secret'

// eslint-disable-next-line no-empty-pattern -- needs testInfo, no fixture.
test('a run that needs a secret while the vault is locked waits in Review and continues on unlock', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-secrets-run-wait-${idx}-`))
  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({
      port: SECRETS_RUN_WAIT_SERVER_BASE_PORT + idx,
      mcpPort: SECRETS_RUN_WAIT_MCP_BASE_PORT + idx,
      settingsPath: path.join(dir, 'settings.json'),
      executionDbPath: path.join(dir, 'execution.db'),
      backupDir: path.join(dir, 'backups'),
    })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(`${server.baseURL}/`)

    // --- A vault with the seeded API-key credential adopted into it:
    // creation seeds the demo entry, the first unlock adopts the
    // seeded request's key. Then lock it. ---
    await page.getByRole('link', { name: 'Secrets' }).click()
    await expect(page.getByTestId('secrets-view')).toBeVisible()
    const intro = page.getByRole('dialog', { name: 'Keep credentials out of your workflows' })
    await expect(intro).toBeVisible()
    await intro.getByRole('button', { name: 'Got it' }).click()
    await page.getByTestId('secrets-setup-cta').click()
    await expect(page.getByTestId('secrets-view').getByText('Example Login', { exact: true })).toBeVisible()
    await page.getByTestId('secrets-lock').click()
    await expect(page.getByText('Vault is locked')).toBeVisible()
    await page.getByTestId('secrets-unlock-cta').click()
    await expect(page.getByTestId('secrets-view').getByText('Example Login', { exact: true })).toBeVisible()
    await page.getByTestId('secrets-lock').click()
    await expect(page.getByText('Vault is locked')).toBeVisible()

    // --- Run the seeded workflow by hand while locked. ---
    await page.getByRole('link', { name: 'Workflows' }).click()
    const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(WORKFLOW, { exact: true }) })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Run' }).click()

    // --- An external step asks first; approving it reaches the step
    // that needs the secret, which then waits for the vault. ---
    await page.getByRole('link', { name: 'Review' }).click()
    const ask = page.getByTestId('review-item').filter({ hasText: WORKFLOW }).first()
    await expect(ask).toBeVisible({ timeout: 10_000 })
    await ask.getByTestId('review-approve').click()

    const wait = page.getByTestId('review-vault-wait-item').filter({ hasText: WORKFLOW }).first()
    await expect(wait).toBeVisible({ timeout: 15_000 })
    await expect(wait.getByTestId('review-vault-wait-title')).toHaveText('Waiting for the vault to unlock')
    await expect(wait.getByTestId('review-vault-wait-badge')).toHaveText('waiting for vault')
    await expect(wait).toContainText('This run needs a secret. Unlock the vault and it continues from the step that stopped.')
    await expect(wait.getByTestId('review-vault-wait-unlock-vault')).toHaveText('Unlock vault')
    await expect(wait.getByTestId('review-vault-wait-stop-run')).toHaveText('Stop run')
    // The sidebar's Review count includes the wait.
    await expect(page.getByLabel('1 pending in Review').first()).toBeVisible()
    // The reviewed screenshot of this state (testing.md), when a caller
    // names where to put it.
    if (process.env.MILL_SCREENSHOT_PATH) await page.screenshot({ path: process.env.MILL_SCREENSHOT_PATH })

    // --- Unlock vault from the card: the run continues and the card
    // resolves. ---
    await wait.getByTestId('review-vault-wait-unlock-vault').click()
    await expect(page.getByTestId('review-vault-wait-item')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByTestId('review-empty')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('resumed', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  } finally {
    await browser.close()
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
