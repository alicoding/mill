import { chromium, expect, test } from '@playwright/test'
import { openPlacementPopover } from './fixtures/atlasBoard'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ATLAS_KIND_AUTHORING_MCP_BASE_PORT,
  ATLAS_KIND_AUTHORING_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'

// Kind/LinkKind authoring (goal 0079): the Kinds dialog on the board
// toolbar is the one in-app door into Atlas vocabulary -- create,
// edit (under ADR-0040 field evolution: a saved field's key/type are
// immutable, removal tombstones), and delete (server-refused while in
// use). DEDICATED server pair: kinds are global vocabulary every
// board render and picker reads, never shared-pool state
// (testing.md's shared-vs-dedicated rule).

async function withServer(testInfo: { parallelIndex: number }, run: (page: Awaited<ReturnType<import('@playwright/test').Browser['newPage']>>) => Promise<void>): Promise<void> {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-kind-authoring-${idx}-`))
  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({
      port: ATLAS_KIND_AUTHORING_SERVER_BASE_PORT + idx,
      mcpPort: ATLAS_KIND_AUTHORING_MCP_BASE_PORT + idx,
      settingsPath: path.join(dir, 'settings.json'),
      executionDbPath: path.join(dir, 'execution.db'),
      backupDir: path.join(dir, 'backups'),
    })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(page.getByTestId('atlas-board')).toBeVisible()
    await run(page)
  } finally {
    await browser.close()
    await server?.stop()
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

const dialog = (page: import('@playwright/test').Page) => page.locator('[data-component="atlas-kind-manager"]')

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('create a card kind with a choice field, see it in the create picker, edit it under evolution rules, delete it', async ({}, testInfo) => {
  await withServer(testInfo, async (page) => {
    await page.getByTestId('atlas-open-kinds').click()
    await expect(dialog(page)).toBeVisible()

    // Create: label + one Choice field.
    await dialog(page).getByTestId('atlas-kind-new').click()
    await page.getByTestId('atlas-kind-icon').fill('🚦')
    await page.getByTestId('atlas-kind-label').fill('ZzE2eSignal')
    await page.getByTestId('atlas-kind-add-field').click()
    await page.getByTestId('atlas-kind-field-key').fill('severity')
    await page.getByTestId('atlas-kind-field-label').fill('Severity')
    await page.getByTestId('atlas-kind-field-type').selectOption('options')
    await page.getByTestId('atlas-kind-field-options').fill('low, high')
    await page.getByTestId('atlas-kind-save').click()

    // Back on the list, the new kind shows with its field count.
    const row = dialog(page).getByTestId('atlas-kind-row').filter({ hasText: 'ZzE2eSignal' })
    await expect(row).toBeVisible()
    await expect(row).toContainText('1 field')

    // Evolution rules: reopening the kind, the saved field's key and
    // type are immutable; the label stays editable.
    await row.click()
    await expect(page.getByTestId('atlas-kind-field-key')).toBeDisabled()
    await expect(page.getByTestId('atlas-kind-field-type')).toBeDisabled()
    await expect(page.getByTestId('atlas-kind-field-label')).toBeEnabled()
    await page.getByTestId('atlas-kind-cancel').click()

    // The picker offers it: close the dialog, arm a card placement.
    await page.keyboard.press('Escape')
    await expect(dialog(page)).not.toBeVisible()
    await openPlacementPopover(page)
    await page.getByTestId('atlas-placement-kind').click()
    await expect(page.getByText('ZzE2eSignal', { exact: false }).first()).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    // Delete: unused, so it goes; the row disappears.
    await page.getByTestId('atlas-open-kinds').click()
    await dialog(page).getByRole('button', { name: 'Delete ZzE2eSignal' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog(page).getByTestId('atlas-kind-row').filter({ hasText: 'ZzE2eSignal' })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('create, edit, and delete a link kind; deleting an in-use card kind is refused with the server reason', async ({}, testInfo) => {
  await withServer(testInfo, async (page) => {
    await page.getByTestId('atlas-open-kinds').click()
    await expect(dialog(page)).toBeVisible()

    // Link kind: create, rename, delete.
    await dialog(page).getByTestId('atlas-linkkind-new').click()
    await page.getByTestId('atlas-linkkind-label').fill('ZzE2eFlowsTo')
    await page.getByTestId('atlas-linkkind-save').click()
    const lkRow = dialog(page).getByTestId('atlas-linkkind-row').filter({ hasText: 'ZzE2eFlowsTo' })
    await expect(lkRow).toBeVisible()
    await lkRow.click()
    await page.getByTestId('atlas-linkkind-label').fill('ZzE2eFlowsInto')
    await page.getByTestId('atlas-linkkind-save').click()
    const renamed = dialog(page).getByTestId('atlas-linkkind-row').filter({ hasText: 'ZzE2eFlowsInto' })
    await expect(renamed).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Delete ZzE2eFlowsInto' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog(page).getByTestId('atlas-linkkind-row').filter({ hasText: 'ZzE2eFlowsInto' })).toHaveCount(0)

    // In-use refusal: the seeded Topic kind backs seeded cards, so
    // deleting it surfaces the server's still-used reason inline.
    await dialog(page).getByRole('button', { name: 'Delete Topic' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog(page).getByTestId('atlas-kind-manager-error')).toContainText('still used')
    await page.keyboard.press('Escape')
  })
})
