import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CODING_LOOP_SECRETS_MCP_BASE_PORT, CODING_LOOP_SECRETS_SERVER_BASE_PORT, spawnMillServer, type SpawnedServer } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'
import { writeHostClipboardText, hostClipboardAvailable } from './fixtures/hostClipboard'
import { paletteDialog } from './fixtures/palette'

// The coding loop's secret resolution CHAIN (goal 0240 S2): a captured
// command referencing a secret-shaped env var resolves through vault ->
// shell env -> typed-at-Confirm, and the resolved value never appears
// in the visible run result. Dedicated server (own MILL_SECRETS_PATH,
// same reasoning as secrets.spec.ts): this spec creates a real vault
// entry, and vault existence/lock state is GLOBAL app state the shared
// worker pool coding-loop.spec.ts runs on must never see. NEVER a real
// secret -- both values below are throwaway fixtures scoped to this
// spec's own temp vault/clipboard.

// eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
test('Coding loop secret chain: a vault entry resolves, a typed value resolves, neither leaks into the result', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-coding-loop-secrets-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = CODING_LOOP_SECRETS_SERVER_BASE_PORT + idx
  const mcpPort = CODING_LOOP_SECRETS_MCP_BASE_PORT + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({ port, mcpPort, settingsPath, executionDbPath, backupDir })
    const page = await browser.newPage()
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(`${server.baseURL}/`)

    if (!hostClipboardAvailable) {
      // The honest never-silent failure path (no real pasteboard on this
      // runner) -- coding-loop.spec.ts's own precedent. Nothing below is
      // reachable without a real clipboard, so this spec ends here too.
      return
    }

    // --- Set up the vault and one fixture entry the chain will match ---
    await page.getByRole('link', { name: 'Secrets' }).click()
    await expect(page.getByTestId('secrets-view')).toBeVisible()
    // Fresh server, first Secrets visit: the first-run intro (goal
    // 0202) shows once -- dismissing it here also proves it never
    // traps an unrelated flow.
    await page.getByRole('dialog', { name: 'Keep credentials out of your workflows' }).getByRole('button', { name: 'Got it' }).click()
    await page.getByTestId('secrets-setup-cta').click()
    const list = page.getByTestId('secrets-view')
    await expect(list.getByText('Example Login', { exact: true })).toBeVisible()

    const vaultFixtureValue = 'coding-loop-e2e-vault-fixture-value'
    await page.getByTestId('secrets-new').click()
    await page.getByTestId('secret-title-input').fill('Coding Loop E2E Secret')
    await page.getByTestId('secret-password-input').fill(vaultFixtureValue)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(list.getByText('Coding Loop E2E Secret', { exact: true })).toBeVisible()

    // --- Capture a command referencing that entry's normalized name ---
    await withClipboardLock(async () => {
      writeHostClipboardText('echo "vault-check=$CODING_LOOP_E2E_SECRET"')

      await page.keyboard.press('Meta+K')
      await expect(paletteDialog(page)).toBeVisible()
      await paletteDialog(page).getByRole('combobox').fill('run from clipboard')
      await paletteDialog(page).getByRole('option', { name: 'Run from clipboard…', exact: true }).click()

      const dialog = page.getByRole('dialog', { name: 'Run from clipboard' })
      await expect(dialog).toBeVisible()

      const confirm = page.getByTestId('coding-loop-confirm')
      await expect(confirm).toBeVisible({ timeout: 10_000 })
      // --- The Confirm screen shows WHICH source this secret resolves
      // from, per goal 0240's own design contract ---
      const secretRow = page.getByTestId('coding-loop-confirm-secret-CODING_LOOP_E2E_SECRET')
      await expect(secretRow).toBeVisible()
      await expect(secretRow).toContainText('From your vault')
      await expect(secretRow).toContainText('Coding Loop E2E Secret')

      await page.getByTestId('coding-loop-confirm-run').click()
      const result = page.getByTestId('coding-loop-result')
      await expect(result).toBeVisible({ timeout: 20_000 })
      const output = page.getByTestId('coding-loop-result-output')
      // The resolved value substituted for real (the shell actually saw
      // it) but never survives into the saved/visible result.
      await expect(output).not.toContainText(vaultFixtureValue)
      await expect(output).toContainText('[redacted]')

      await dialog.getByLabel('Close').click()
    })

    // --- Typed-at-Confirm path: no vault entry, no shell env var for
    // this name -- the Confirm screen must ask the user to type it, and
    // the typed value must never appear in the result either. ---
    await withClipboardLock(async () => {
      writeHostClipboardText('echo "typed-check=$CODING_LOOP_E2E_TYPED_TOKEN"')

      await page.keyboard.press('Meta+K')
      await expect(paletteDialog(page)).toBeVisible()
      await paletteDialog(page).getByRole('combobox').fill('run from clipboard')
      await paletteDialog(page).getByRole('option', { name: 'Run from clipboard…', exact: true }).click()

      const dialog = page.getByRole('dialog', { name: 'Run from clipboard' })
      await expect(dialog).toBeVisible()

      const confirm = page.getByTestId('coding-loop-confirm')
      await expect(confirm).toBeVisible({ timeout: 10_000 })
      const secretRow = page.getByTestId('coding-loop-confirm-secret-CODING_LOOP_E2E_TYPED_TOKEN')
      await expect(secretRow).toBeVisible()

      const runButton = page.getByTestId('coding-loop-confirm-run')
      await expect(runButton).toBeDisabled()

      const typedFixtureValue = 'coding-loop-e2e-typed-fixture-value'
      await page.getByTestId('coding-loop-confirm-secret-input-CODING_LOOP_E2E_TYPED_TOKEN').fill(typedFixtureValue)
      await expect(runButton).toBeEnabled()

      await runButton.click()
      const result = page.getByTestId('coding-loop-result')
      await expect(result).toBeVisible({ timeout: 20_000 })
      const output = page.getByTestId('coding-loop-result-output')
      await expect(output).not.toContainText(typedFixtureValue)
      await expect(output).toContainText('[redacted]')

      await dialog.getByLabel('Close').click()
    })
  } finally {
    await browser.close()
    if (server) await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
