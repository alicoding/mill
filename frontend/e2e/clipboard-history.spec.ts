import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CLIPBOARD_HISTORY_MCP_BASE_PORT, CLIPBOARD_HISTORY_SERVER_BASE_PORT, spawnMillServer, type SpawnedServer } from './fixtures/server'
import { paletteDialog } from './fixtures/palette'
import { seedClipboardHistoryEntry } from './fixtures/clipboardHistorySeed'
import { withClipboardLock } from './fixtures/clipboardLock'

// Clipboard history (goal 0234): the surface's own task -- search,
// preview, copy, pin, and delete what's been captured -- driven end to
// end. Dedicated server (own settings file): the entry list is GLOBAL
// app state (testing.md's shared-vs-dedicated rule) and this spec
// asserts the true empty state, which needs a guaranteed-fresh
// settings file. Entries are seeded via ExecutionService.
// RunWorkflowWithPayload (fixtures/clipboardHistorySeed.ts), never a
// real clipboard copy -- goal 0234's own e2e-divergence note: the real
// trigger needs an actual macOS clipboard change to fire, which is
// CI-hostile on headless runners.
// eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
test('Clipboard history: empty state, then search/preview/copy/pin/delete a real seeded entry', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-clipboard-history-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = CLIPBOARD_HISTORY_SERVER_BASE_PORT + idx
  const mcpPort = CLIPBOARD_HISTORY_MCP_BASE_PORT + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({ port, mcpPort, settingsPath, executionDbPath, backupDir })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible()

    const openClipboardHistory = async () => {
      await page.keyboard.press('Meta+K')
      await expect(paletteDialog(page)).toBeVisible()
      await paletteDialog(page).getByRole('combobox').fill('clipboard history')
      await paletteDialog(page).getByRole('option', { name: 'Clipboard history', exact: true }).click()
    }

    const dialog = page.getByRole('dialog', { name: 'Clipboard history' })

    // --- Empty state offers the door to the workflow that fills it ---
    await openClipboardHistory()
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('clipboard-history-empty')).toContainText('Copies appear here once the Clipboard history workflow is on.')
    const openWorkflowButton = page.getByTestId('clipboard-history-open-workflow')
    await expect(openWorkflowButton).toBeVisible()
    await openWorkflowButton.click()
    // Opening the door closes the dialog and lands on the seeded
    // workflow's own editor tab.
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('tab', { name: 'Clipboard history', selected: true })).toBeVisible()

    // --- Seed two real entries via the same production run path a
    // real capture goes through, one plain and one code-shaped ---
    await seedClipboardHistoryEntry(page, 'buy milk on the way home')
    await seedClipboardHistoryEntry(page, 'function greet() {\n  console.log("hi")\n}')

    await openClipboardHistory()
    await expect(dialog).toBeVisible()

    const codeRow = dialog.getByRole('option', { name: /function greet/ })
    const plainRow = dialog.getByRole('option', { name: /buy milk/ })
    await expect(codeRow).toBeVisible()
    await expect(plainRow).toBeVisible()

    // --- Search filters the list ---
    const search = dialog.getByPlaceholder('Search clipboard history')
    await search.fill('milk')
    await expect(plainRow).toBeVisible()
    await expect(codeRow).toBeHidden()
    await search.fill('')

    // --- Selecting the code entry previews it in monospace, full
    // multi-line content preserved ---
    await codeRow.click()
    const detailText = page.getByTestId('clipboard-history-detail-text')
    await expect(detailText).toContainText('function greet() {')
    await expect(detailText).toContainText('console.log("hi")')
    await expect(detailText).toHaveCSS('font-family', /mono/i)

    // --- Selecting the plain entry previews it WITHOUT monospace ---
    await plainRow.click()
    await expect(detailText).toHaveText('buy milk on the way home')
    await expect(detailText).not.toHaveCSS('font-family', /mono/i)

    // --- Copy touches the real OS pasteboard (clipboard.WriteText),
    // one shared resource across every worker (fixtures/clipboardLock.ts)
    // -- outcome asserted success-or-error, not pinned to success:
    // pbcopy doesn't exist on a headless Linux CI runner, same
    // environment-independent pattern secrets.spec.ts's own copy
    // assertion already uses. ---
    await withClipboardLock(async () => {
      await page.getByTestId('clipboard-history-copy').click()
      const copiedState = page.getByTestId('clipboard-history-copy').getByText('Copied', { exact: true })
      const errorState = page.getByTestId('clipboard-history-copy-error')
      await expect(copiedState.or(errorState)).toBeVisible()
    })

    // --- Pin floats the plain entry above the code entry (it's still
    // selected from the Copy step above) ---
    const pinButton = page.getByTestId('clipboard-history-pin')
    await expect(pinButton).toHaveText('Pin')
    await pinButton.click()
    await expect(pinButton).toHaveText('Unpin')
    await expect(dialog.getByRole('option').first()).toHaveAccessibleName(/buy milk/)

    // --- Delete removes the selected entry; deleting the last one
    // returns the dialog to its empty state ---
    await codeRow.click()
    await page.getByTestId('clipboard-history-delete').click()
    await expect(codeRow).toBeHidden()
    await expect(plainRow).toBeVisible()

    await plainRow.click()
    await page.getByTestId('clipboard-history-delete').click()
    await expect(page.getByTestId('clipboard-history-empty')).toBeVisible()
  } finally {
    await browser.close()
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
