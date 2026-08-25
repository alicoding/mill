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
// this suite. Extended for goal 0204's Touch ID protection status
// line/toggle -- the real system authentication prompt is manual-only
// (testing.md's registry), but this server-mode binary's own honest
// "not available in this mode" failure path IS exercisable here.

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

    // --- Touch ID protection status/toggle (goal 0204): this spec runs
    // against a real server-mode binary (task build:server, -tags
    // server), which structurally never compiles presencekey's darwin
    // code -- the exact fail-closed state item 4's build contract
    // requires, exercised here for real rather than assumed. Default
    // status is the plain keychain path, and attempting to turn Touch
    // ID on surfaces the honest "not available in this mode" error
    // instead of hanging or a raw keychain/cgo error string. ---
    await expect(page.getByTestId('secrets-protection-status')).toHaveText('Protected by your login keychain')
    const touchIDToggle = page.getByTestId('secrets-touchid-toggle')
    await expect(touchIDToggle).not.toBeChecked()
    await touchIDToggle.click()
    // Wails wraps a bound method's returned Go error as "RuntimeError: <message>"
    // on the JS side -- the substring match below asserts the actual
    // Go sentinel text (secretsvc.ErrPresenceUnsupported) without
    // depending on that wrapper's exact prefix.
    await expect(page.getByTestId('secrets-touchid-error')).toContainText("Touch ID protection isn't available in this mode")
    await expect(touchIDToggle).not.toBeChecked()
    await expect(page.getByTestId('secrets-protection-status')).toHaveText('Protected by your login keychain')

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
    // only proves the button is wired end to end (RPC fires, some
    // visible result renders). withClipboardLock still guards it: the
    // RPC really does touch the one shared OS pasteboard other workers
    // use. The outcome is asserted success-or-error, not pinned to
    // success: clipboard.WriteText shells out to pbcopy, which doesn't
    // exist on a headless Linux CI runner (docs/SPEC.md §1.3) -- same
    // environment-independent pattern composition-seeded-runs.spec.ts/
    // codeexec.spec.ts already use for every other real-clipboard RPC.
    await withClipboardLock(async () => {
      await page.getByTestId('secret-detail-copy').click()
      await expect(page.getByTestId('secret-detail-copied').or(page.getByTestId('secret-detail-error'))).toBeVisible()
    })

    // --- Access history (goal 0203 S3): the reveal (and, when the real
    // clipboard write succeeded, the copy) just performed each leave a
    // visible row, in the user's own vocabulary, from the entry's own
    // filtered view. Scoped to the currently-open detail dialog: the
    // Secrets view header's own global Access history button carries
    // the identical accessible name, still present (unmounted) behind
    // this modal. ---
    const bankDetailDialog = page.getByRole('dialog', { name: 'Bank of Testing', exact: true })
    await bankDetailDialog.getByRole('button', { name: 'Access history' }).click()
    const entryAccessHistory = page.getByRole('dialog', { name: /Access history for/ })
    await expect(entryAccessHistory).toBeVisible()
    await expect(entryAccessHistory.getByText('Shown to you')).toBeVisible()
    await entryAccessHistory.getByLabel('Close').click()
    await expect(bankDetailDialog).toBeVisible()

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
    // exact: true -- "History" is otherwise a substring match against
    // this same dialog's own "Access history" footer button.
    await page.getByRole('button', { name: 'History', exact: true }).click()
    const historyRow = page.getByTestId('secret-history-row')
    await expect(historyRow).toHaveCount(1)
    await historyRow.getByLabel('Show password').click()
    await expect(historyRow.locator('input')).toHaveValue('first-password-fake')
    await page.getByRole('dialog', { name: /History for/ }).getByLabel('Close').click()
    await page.getByRole('dialog', { name: 'Bank of Testing', exact: true }).getByLabel('Close').click()

    // --- Global Access history (Secrets view header, goal 0203 S3):
    // every read/reveal/copy this run performed against "Bank of
    // Testing" shows up, newest first, each carrying the entry's own
    // label -- unlike the per-entry filtered view above, which shows
    // context only, this list needs the label to tell entries apart. ---
    await page.getByTestId('secrets-access-history-open').click()
    const globalAccessHistory = page.getByRole('dialog', { name: 'Access history', exact: true })
    await expect(globalAccessHistory).toBeVisible()
    await expect(globalAccessHistory.getByText('Bank of Testing').first()).toBeVisible()
    // Copied to the clipboard vs. Couldn't be read -- environment-
    // dependent, same reasoning the earlier real-clipboard step's own
    // comment gives (headless Linux CI has no pbcopy); either one
    // proves the copy attempt left a row.
    await expect(globalAccessHistory.getByText('Copied to the clipboard').or(globalAccessHistory.getByText("Couldn't be read"))).toBeVisible()
    await globalAccessHistory.getByLabel('Close').click()

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

    // Regression: a Touch ID toggle error from the unlocked view must
    // not survive a Lock -- it's a stale message about a DIFFERENT
    // action, not the locked blankslate's own state.
    await page.getByTestId('secrets-touchid-toggle').click()
    await expect(page.getByTestId('secrets-touchid-error')).toBeVisible()
    await page.getByTestId('secrets-lock').click()
    await expect(page.getByText('Vault is locked')).toBeVisible()
    await expect(page.getByText("Touch ID protection isn't available in this mode")).toHaveCount(0)
  } finally {
    await browser.close()
    if (server) await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
