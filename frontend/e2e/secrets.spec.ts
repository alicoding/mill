import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SECRETS_MCP_BASE_PORT, SECRETS_SERVER_BASE_PORT, spawnMillServer, type SpawnedServer } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'
import { paletteDialog } from './fixtures/palette'

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

    // --- First visit shows the first-run intro exactly once (goal
    // 0202, shared/FirstRunIntro.tsx): dismissing records seen
    // SERVER-side, so a reload -- a fresh page/session against the
    // same server, the second-device stand-in this harness can
    // reach -- never shows it again. ---
    const intro = page.getByRole('dialog', { name: 'Keep credentials out of your workflows' })
    await expect(intro).toBeVisible()
    await intro.getByRole('button', { name: 'Got it' }).click()
    await expect(intro).toHaveCount(0)
    await page.reload()
    await page.getByRole('link', { name: 'Secrets' }).click()
    await expect(page.getByTestId('secrets-view')).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Keep credentials out of your workflows' })).toHaveCount(0)

    // --- No vault yet: Create vault ---
    await expect(page.getByText('Store a password')).toBeVisible()
    await page.getByTestId('secrets-setup-cta').click()

    // --- Setup seeds one demo entry (secret.BuiltInDemo -- the seed IS the proof) ---
    const list = page.getByTestId('secrets-view')
    await expect(list.getByText('Example Login', { exact: true })).toBeVisible()

    // --- The unlock requirement's toggle (goal 0330): this spec runs
    // against a real server-mode binary (task build:server, -tags
    // server), which never compiles the LocalAuthentication adapter's
    // darwin code, so this Mac-shaped requirement cannot be honoured
    // here at all. The surface says so and refuses to offer it, rather
    // than accepting a setting it could never enforce. ---
    await expect(page.getByTestId('secrets-protection-status')).toHaveText('Protected by your login keychain')
    const touchIDToggle = page.getByTestId('secrets-touchid-toggle')
    await expect(touchIDToggle).not.toBeChecked()
    await expect(touchIDToggle).toBeDisabled()
    await expect(page.getByText("Touch ID or a password isn't set up on this Mac.")).toBeVisible()

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
    // Goal 0222 S1: the vault-lock state door (shared/vaultStatusStore.ts)
    // makes secrets.lockVault/unlockVault palette-visible state, exactly
    // one at a time -- unlocked here, so only "Lock vault" shows.
    // exact: true throughout -- "Unlock vault" contains "lock vault" as
    // a case-insensitive substring of "Lock vault", so Playwright's
    // default (non-exact) role-name matching would find the wrong one.
    await page.keyboard.press('Meta+k')
    await expect(paletteDialog(page)).toBeVisible()
    await paletteDialog(page).getByRole('combobox').fill('vault')
    await expect(paletteDialog(page).getByRole('option', { name: 'Lock vault', exact: true })).toBeVisible()
    await expect(paletteDialog(page).getByRole('option', { name: 'Unlock vault', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.getByTestId('secrets-lock').click()
    await expect(page.getByText('Vault is locked')).toBeVisible()

    // Locked now -- the palette flips to showing only "Unlock vault".
    await page.keyboard.press('Meta+k')
    await expect(paletteDialog(page)).toBeVisible()
    await paletteDialog(page).getByRole('combobox').fill('vault')
    await expect(paletteDialog(page).getByRole('option', { name: 'Unlock vault', exact: true })).toBeVisible()
    await expect(paletteDialog(page).getByRole('option', { name: 'Lock vault', exact: true })).toHaveCount(0)

    // Running it from the palette performs the exact same
    // SecretService.UnlockVault() the view's own button makes.
    await paletteDialog(page).getByRole('option', { name: 'Unlock vault', exact: true }).click()
    await expect(paletteDialog(page)).toHaveCount(0)
    await expect(list.getByText('Example Login', { exact: true })).toBeVisible()

    // A vault this device CAN open shows no failure line, and never
    // offers to replace itself.
    await page.getByTestId('secrets-lock').click()
    await expect(page.getByText('Vault is locked')).toBeVisible()
    await expect(page.getByTestId('secrets-unlock-error')).toHaveCount(0)
    await expect(page.getByTestId('secrets-reset-cta')).toHaveCount(0)
  } finally {
    await browser.close()
    if (server) await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

// Goal 0330: a vault file whose key this device does not hold. The
// server's keyring is process-local (MILL_TEST_KEYRING=memory), so a
// second server over the SAME vault file reproduces exactly that -- the
// file is there, the key is not. The locked state has to SAY so and
// offer the one door out, and taking it must keep the unreadable file
// rather than deleting it. Dedicated server pair (own
// MILL_SECRETS_PATH) for the same reason the spec above has one.
// eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
test('secret manager: a vault with no key on this device says so, and Start a new vault keeps the old file', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-secrets-nokey-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = SECRETS_SERVER_BASE_PORT + idx
  const mcpPort = SECRETS_MCP_BASE_PORT + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    // --- First run: create the vault. Its key lands in THIS process's
    // in-memory keyring and nowhere else. ---
    server = await spawnMillServer({ port, mcpPort, settingsPath, executionDbPath, backupDir })
    let page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Secrets' }).click()
    await page.getByRole('button', { name: 'Got it' }).click()
    await page.getByTestId('secrets-setup-cta').click()
    await expect(page.getByTestId('secrets-view').getByText('Example Login', { exact: true })).toBeVisible()
    await page.close()
    await server.stop()

    // --- Second run: same vault file, empty keyring. ---
    server = await spawnMillServer({ port, mcpPort, settingsPath, executionDbPath, backupDir })
    page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Secrets' }).click()
    await expect(page.getByText('Vault is locked')).toBeVisible()

    // Unlock ANSWERS: this button used to reject into the console, so
    // nothing on screen changed at all.
    await page.getByTestId('secrets-unlock-cta').click()
    await expect(page.getByTestId('secrets-unlock-error')).toHaveText("There's no key for this vault on this device.")

    // --- The one door out, confirmed by name ---
    await page.getByTestId('secrets-reset-cta').click()
    const confirm = page.getByRole('alertdialog', { name: 'Start a new vault?' })
    await expect(confirm).toBeVisible()
    await expect(confirm.getByText('The current file is kept as a backup.', { exact: false })).toBeVisible()
    await confirm.getByRole('button', { name: 'Start new vault' }).click()

    // A working, unlocked vault with its own seeded example.
    await expect(page.getByTestId('secrets-view').getByText('Example Login', { exact: true })).toBeVisible()

    // The unreadable file is kept beside the new one, never deleted.
    const backups = readdirSync(dir).filter((f) => f.startsWith('secrets.kdbx.') && f.endsWith('.bak'))
    expect(backups).toHaveLength(1)
  } finally {
    await browser.close()
    if (server) await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
