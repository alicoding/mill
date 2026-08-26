import { chromium, expect, test } from '@playwright/test'
import { openToolbarAction } from './fixtures/toolbarActions'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { contextMenu } from './fixtures/contextMenu'
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
    await openToolbarAction(page, 'atlas-open-kinds')
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
    // The kind picker's surviving generic surface is the New space
    // dialog (goal 0144 removed the placement popover).
    await page.getByTestId('atlas-board').click({ button: 'right', position: { x: 180, y: 420 } })
    await page.getByText('New space…', { exact: true }).click()
    await page.getByTestId('atlas-create-kind').click()
    await expect(page.getByText('ZzE2eSignal', { exact: false }).first()).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Cancel' }).click()

    // Delete: unused, so it goes; the row disappears.
    await openToolbarAction(page, 'atlas-open-kinds')
    await dialog(page).getByRole('button', { name: 'Delete ZzE2eSignal' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog(page).getByTestId('atlas-kind-row').filter({ hasText: 'ZzE2eSignal' })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('create, edit, and delete a link kind; deleting an in-use card kind is refused with the server reason', async ({}, testInfo) => {
  await withServer(testInfo, async (page) => {
    await openToolbarAction(page, 'atlas-open-kinds')
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

// Face fields (goal 0152 slice 1): a Kind declares which field values
// surface on its cards' faces. Two proofs on one dedicated server:
// the editor's Show-on-card toggle round-trips, and the SEEDED Topic
// kind (status ShowOnCard, seed rev 3) renders its pill on the
// "Discovery workstream" card's face.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('show-on-card round-trips in the editor, and the seeded Topic status renders as a face pill', async ({}, testInfo) => {
  await withServer(testInfo, async (page) => {
    // Seeded proof first: Discovery workstream (Topic, status "Open").
    const getting = page.locator('[data-testid="atlas-note-card"]', { hasText: 'Discovery workstream' })
    await expect(getting).toBeVisible()
    await expect(getting.getByTestId('atlas-face-field')).toHaveText('Open')

    // Editor round-trip on a fresh kind (never a seeded one).
    await openToolbarAction(page, 'atlas-open-kinds')
    await expect(dialog(page)).toBeVisible()
    await dialog(page).getByTestId('atlas-kind-new').click()
    await page.getByTestId('atlas-kind-label').fill('ZzE2eFaceKind')
    await page.getByTestId('atlas-kind-add-field').click()
    await page.getByTestId('atlas-kind-field-key').fill('stage')
    await page.getByTestId('atlas-kind-field-label').fill('Stage')
    await page.getByTestId('atlas-kind-field-showoncard').check()
    await page.getByTestId('atlas-kind-save').click()

    const row = dialog(page).getByTestId('atlas-kind-row').filter({ hasText: 'ZzE2eFaceKind' })
    await expect(row).toBeVisible()
    await row.click()
    await expect(page.getByTestId('atlas-kind-field-showoncard')).toBeChecked()
    await page.getByTestId('atlas-kind-cancel').click()

    // Clean up.
    await dialog(page).getByRole('button', { name: 'Delete ZzE2eFaceKind' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(row).toHaveCount(0)
    await page.keyboard.press('Escape')
  })
})

// Card-reference fields (goal 0152 slice 2): a Kind field targets
// exactly one other kind; the card page's picker offers only
// compatible cards, and a set reference derives a labeled board edge
// plus (with Show on card) the target's title on the face. The test
// card is created over the same runtime wire the generated bindings
// use (mcpTestClient.ts's Call.ByName precedent) -- creating a card
// of an arbitrary new kind has no dedicated UI flow to drive.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('a card-reference field filters to its target kind, derives a board edge, and shows on the face', async ({}, testInfo) => {
  await withServer(testInfo, async (page) => {
    // Author the kind: one cardref field targeting Contact, on-card.
    await openToolbarAction(page, 'atlas-open-kinds')
    await expect(dialog(page)).toBeVisible()
    await dialog(page).getByTestId('atlas-kind-new').click()
    await page.getByTestId('atlas-kind-label').fill('ZzE2eTicket')
    await page.getByTestId('atlas-kind-add-field').click()
    await page.getByTestId('atlas-kind-field-key').fill('owner')
    await page.getByTestId('atlas-kind-field-label').fill('Owner')
    await page.getByTestId('atlas-kind-field-type').selectOption('cardref')
    await page.getByTestId('atlas-kind-field-refkind').selectOption({ label: 'Topic' })
    await page.getByTestId('atlas-kind-field-showoncard').check()
    await page.getByTestId('atlas-kind-save').click()
    await expect(dialog(page).getByTestId('atlas-kind-row').filter({ hasText: 'ZzE2eTicket' })).toBeVisible()
    await page.keyboard.press('Escape')

    // Create a card of the new kind over the runtime wire.
    const callBound = async (methodName: string, args: unknown[]) => {
      const res = await page.request.post(new URL('/wails/runtime', page.url()).toString(), {
        headers: { 'x-wails-client-id': 'e2e-cardref', 'Content-Type': 'application/json' },
        data: { object: 0, method: 0, args: { 'call-id': `e2e-cardref-${Date.now()}`, methodName, args } },
      })
      const text = await res.text()
      if (!res.ok()) throw new Error(`${methodName} failed: ${res.status()} ${text}`)
      return JSON.parse(text)
    }
    const kinds = (await callBound('github.com/alicoding/mill/internal/services/atlassvc.AtlasService.Kinds', [])) as { ID: string; Label: string }[]
    const ticketKindID = kinds.find((k) => k.Label === 'ZzE2eTicket')!.ID
    // File the card into the root space -- the board renders one
    // level, and a parentless card sits above it.
    const allCards = (await callBound('github.com/alicoding/mill/internal/services/atlassvc.AtlasService.Cards', [])) as { ID: string; Title: string }[]
    const spaceID = allCards.find((c) => c.Title === 'The engagement')!.ID
    const created = await callBound('github.com/alicoding/mill/internal/services/atlassvc.AtlasService.CreateCard',
      [ticketKindID, 'ZzE2eTicketCard', '', {}, spaceID, { X: 120, Y: 480 }, '', '', '', '']) as { ID: string }
    if (!created.ID) throw new Error('CreateCard returned no ID')
    // A request-context POST bypasses the page's own event stream --
    // reload so the board reads the created card deterministically.
    await page.reload()
    await page.getByRole('link', { name: 'Atlas' }).click()

    const ticketCard = page.locator('[data-testid="atlas-note-card"]', { hasText: 'ZzE2eTicketCard' })
    await expect(ticketCard).toBeVisible()

    // The page picker offers only Contact cards.
    await ticketCard.click({ modifiers: ['Meta'] })
    const overlay = page.locator('[data-component="atlas-card-overlay"]')
    await expect(overlay).toBeVisible()
    // An empty field is a one-line + Add invitation (goal 0106) --
    // expand it before the picker exists.
    await overlay.locator('[data-testid="atlas-page-add-field"]', { hasText: 'Owner' }).click()
    const ownerSelect = overlay.locator('[data-testid="atlas-field"][data-field-key="owner"]')
    await expect(ownerSelect.locator('option', { hasText: 'Discovery workstream' })).toHaveCount(1)
    await expect(ownerSelect.locator('option', { hasText: 'Jordan Reyes' })).toHaveCount(0)
    await ownerSelect.selectOption({ label: 'Discovery workstream' })
    await page.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()

    // The reference derives a labeled dashed edge and a face value.
    await expect(page.locator('.react-flow__edge', { hasText: 'Owner' })).toHaveCount(1)
    await expect(ticketCard.getByTestId('atlas-face-field')).toHaveText('Discovery workstream')

    // Clean up: card then kind.
    const menu = contextMenu(page)
    await ticketCard.click({ button: 'right' })
    await menu.getByText('Delete', { exact: true }).first().click()
    await expect(ticketCard).toHaveCount(0)
    await openToolbarAction(page, 'atlas-open-kinds')
    await dialog(page).getByRole('button', { name: 'Delete ZzE2eTicket' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog(page).getByTestId('atlas-kind-row').filter({ hasText: 'ZzE2eTicket' })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })
})
