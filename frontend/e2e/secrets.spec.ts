import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SECRETS_MCP_BASE_PORT, SECRETS_SERVER_BASE_PORT, spawnMillServer, type SpawnedServer } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'

// The secret manager's human-facing surface (goal 0185 S2): create a
// vault, store a password, reveal/hide it, copy it to the real OS
// clipboard, edit it, view its history, delete it, then lock/unlock the
// vault -- the exact task the capability exists for ("keep passwords
// and keys in one encrypted vault on this device"), not just the
// elements the diff touched (.claude/rules/testing.md). Dedicated
// server (own MILL_SECRETS_PATH): vault existence/lock state is GLOBAL
// app state, same reasoning as every other dedicated-server spec in
// this suite.

// eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
test('secret manager: create vault, store/reveal/copy/edit/history/delete a password, lock and unlock', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-secrets-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = SECRETS_SERVER_BASE_PORT + idx
  const mcpPort = SECRETS_MCP_BASE_PORT + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    // spawnMillServer derives MILL_SECRETS_PATH from settingsPath's own
    // directory automatically (fixtures/server.ts) -- no override needed.
    server = await spawnMillServer({ port, mcpPort, settingsPath, executionDbPath, backupDir })
    const page = await browser.newPage()
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Secrets' }).click()
    await expect(page.getByTestId('secrets-view')).toBeVisible()

    // --- No vault yet: Create vault ---
    await expect(page.getByText('Store a password')).toBeVisible()
    await page.getByTestId('secrets-setup-cta').click()

    // --- Setup seeds one demo entry (secret.BuiltInDemo -- the seed IS the proof) ---
    const list = page.getByTestId('secrets-view')
    await expect(list.getByText('Example Login', { exact: true })).toBeVisible()

    // --- Create a new secret ---
    await page.getByTestId('secrets-new').click()
    await page.getByTestId('secret-title-input').fill('Bank of Testing')
    await page.getByTestId('secret-username-input').fill('alice')
    await page.getByTestId('secret-password-input').fill('first-password-fake')
    await page.getByTestId('secret-url-input').fill('https://bank.example')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(list.getByText('Bank of Testing', { exact: true })).toBeVisible()

    // --- Reveal + copy (real OS clipboard, serialized via the lock) ---
    await list.getByText('Bank of Testing', { exact: true }).click()
    const passwordField = page.getByTestId('secret-detail-password')
    await expect(passwordField).toHaveAttribute('type', 'password')
    await page.getByLabel('Show password').click()
    await expect(passwordField).toHaveValue('first-password-fake')

    // The real pbcopy round-trip is already proven at the Go adapter
    // layer (internal/adapters/clipboard's own TestWriteText) -- this
    // only proves the button is wired end to end (RPC fires, the "Copied"
    // confirmation renders). withClipboardLock still guards it: the RPC
    // really does touch the one shared OS pasteboard other workers use.
    await withClipboardLock(async () => {
      await page.getByTestId('secret-detail-copy').click()
      await expect(page.getByTestId('secret-detail-copied')).toBeVisible()
    })

    // --- Edit: change the password ---
    await page.getByRole('button', { name: 'Edit' }).click()
    const editPassword = page.getByTestId('secret-password-input')
    await expect(editPassword).toHaveValue('first-password-fake')
    await editPassword.fill('second-password-fake')
    await page.getByRole('button', { name: 'Save' }).click()

    // --- Reopen: the new value is what's stored now ---
    await list.getByText('Bank of Testing', { exact: true }).click()
    await page.getByLabel('Show password').click()
    await expect(page.getByTestId('secret-detail-password')).toHaveValue('second-password-fake')

    // --- History: the pre-edit value is preserved ---
    await page.getByRole('button', { name: 'History' }).click()
    const historyRow = page.getByTestId('secret-history-row')
    await expect(historyRow).toHaveCount(1)
    await historyRow.getByLabel('Show password').click()
    await expect(historyRow.locator('input')).toHaveValue('first-password-fake')
    await page.getByRole('dialog', { name: /History for/ }).getByLabel('Close').click()
    await page.getByRole('dialog', { name: 'Bank of Testing', exact: true }).getByLabel('Close').click()

    // --- Delete via the row's kebab menu, confirmed by name ---
    const bankRow = page.getByTestId('inventory-row').filter({ hasText: 'Bank of Testing' })
    await bankRow.getByTestId('inventory-row-menu').click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(list.getByText('Bank of Testing', { exact: true })).toHaveCount(0)

    // --- Lock, then unlock: the seeded entry is still there ---
    await page.getByTestId('secrets-lock').click()
    await expect(page.getByText('Vault is locked')).toBeVisible()
    await page.getByTestId('secrets-unlock-cta').click()
    await expect(list.getByText('Example Login', { exact: true })).toBeVisible()
  } finally {
    await browser.close()
    if (server) await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
