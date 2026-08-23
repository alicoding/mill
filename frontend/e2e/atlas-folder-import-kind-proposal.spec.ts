import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { noteCard, openCard } from './fixtures/atlasBoard'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import {
  KIND_PROPOSAL_MCP_BASE_PORT,
  KIND_PROPOSAL_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'

// goal 0172 S2: the "Create a new type from these files" option inside
// the existing folder-import scan dialog's own per-category Kind
// picker -- proving the whole point end to end (a Kind proposed from
// observed frontmatter, accepted, and its fields actually populated on
// the created cards) against a real fixture folder whose frontmatter
// uses entirely non-Mill keys (ticket/owner/released). DEDICATED
// server, spawned fresh INSIDE each test (not shared across tests in
// this file): every test scans the same fixture folder and would
// otherwise collide on the proposal's own default Kind name.
const FIXTURE_FOLDER = path.join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'kind-proposal-folder')

async function withServer(testInfo: { parallelIndex: number }, run: (page: Awaited<ReturnType<import('@playwright/test').Browser['newPage']>>) => Promise<void>): Promise<void> {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-kind-proposal-${idx}-`))
  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({
      port: KIND_PROPOSAL_SERVER_BASE_PORT + idx,
      mcpPort: KIND_PROPOSAL_MCP_BASE_PORT + idx,
      settingsPath: path.join(dir, 'settings.json'),
      executionDbPath: path.join(dir, 'execution.db'),
      backupDir: path.join(dir, 'backups'),
      extraEnv: { MILL_TEST_FOLDER_PICK_PATH: FIXTURE_FOLDER },
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

const dialog = (page: import('@playwright/test').Page) => page.locator('[data-component="atlas-folder-import-dialog"]')

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('propose a type from non-Mill frontmatter, edit it, add a status field, and see it populate the created cards', async ({}, testInfo) => {
  await withServer(testInfo, async (page) => {
    await page.getByTestId('atlas-add-from-folder').click()
    await expect(dialog(page)).toBeVisible()

    const groups = dialog(page).getByTestId('atlas-folder-import-group')
    await expect(groups).toHaveCount(2) // Files (4 tickets) + Images (logo.png) -- no subfolders in this fixture.
    // Exact match on the category header text -- a loose substring
    // filter (Playwright's own default for a plain string) would also
    // match the create option's own label, which contains "files" in
    // every group's Select regardless of category.
    const filesGroup = groups.filter({ has: page.getByText('Files', { exact: true }) })
    const imagesGroup = groups.filter({ has: page.getByText('Images', { exact: true }) })

    // Selecting the create option expands the panel, prefilled from
    // the fixture's own observed keys (alphabetical: owner/released/
    // ticket) and the folder's own name.
    await filesGroup.getByTestId('atlas-folder-import-kind').selectOption({ label: 'Create a new type from these files' })
    const panel = filesGroup.getByTestId('atlas-kind-proposal')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('atlas-kind-proposal-name')).toHaveValue('kind-proposal-folder')

    const rows = panel.getByTestId('atlas-kind-proposal-field-row')
    await expect(rows).toHaveCount(3)
    // Each row's read-only "Key in your files" text is the exact
    // frontmatter key -- rows are found by that text, never by
    // position, so this doesn't depend on the alphabetical order the
    // inference function itself already pins in its own unit tests.
    const rowFor = (key: string) => rows.filter({ has: page.getByTestId('atlas-kind-proposal-field-key').getByText(key, { exact: true }) })
    // owner: two values (alice/bob) repeating 4x -> options, and the
    // FIRST options field by key order defaults On card.
    await expect(rowFor('owner').getByTestId('atlas-kind-proposal-field-type')).toHaveValue('options')
    await expect(rowFor('owner').getByTestId('atlas-kind-proposal-field-showoncard')).toBeChecked()
    // released: a native YAML boolean in every file -> boolean.
    await expect(rowFor('released').getByTestId('atlas-kind-proposal-field-type')).toHaveValue('boolean')
    // ticket: four distinct values, never repeating -> text, never a
    // date field despite looking ticket-like.
    await expect(rowFor('ticket').getByTestId('atlas-kind-proposal-field-type')).toHaveValue('text')

    // A status field the files never carry, tracked entirely by Mill.
    await panel.getByTestId('atlas-kind-proposal-status-toggle').check()
    await panel.getByTestId('atlas-kind-proposal-status-values').fill('todo, done')

    // Zero-fields case: images carry no frontmatter at all, so the
    // panel shows only the no-fields message -- proven, then this
    // category is switched back to a real Kind so Confirm doesn't
    // create a second, identically-named type.
    await imagesGroup.getByTestId('atlas-folder-import-kind').selectOption({ label: 'Create a new type from these files' })
    await expect(imagesGroup.getByTestId('atlas-kind-proposal-no-fields')).toBeVisible()
    await expect(imagesGroup.getByTestId('atlas-kind-proposal-name')).toHaveCount(0)
    await imagesGroup.getByTestId('atlas-folder-import-kind').selectOption({ label: '📄 Document' })
    await expect(imagesGroup.getByTestId('atlas-kind-proposal')).toHaveCount(0)

    await dialog(page).getByRole('button', { name: /Add \d+ cards/ }).click()
    await expect(dialog(page)).not.toBeVisible()

    // The Kind was created and its fields actually populated from
    // ticket-1.md's own frontmatter -- the whole point of goal 0172.
    const card = noteCard(page, 'Ticket 1')
    await expect(card).toBeVisible()
    await openCard(page, card)
    const overlay = page.locator('[data-component="atlas-card-overlay"]')
    await expect(overlay).toBeVisible()
    await expect(overlay.locator('[data-testid="atlas-field"][data-field-key="ticket"]')).toHaveValue('TCK-1')
    await expect(overlay.locator('[data-testid="atlas-field"][data-field-key="owner"]')).toHaveValue('alice')
    await expect(overlay.locator('[data-testid="atlas-field"][data-field-key="released"]')).toBeChecked()
    // status: an owner-only field the file never carries. Being keyed
    // literally "status" and TypeOptions, it's picked up by the card
    // page's own existing statusFieldOf convention and renders as the
    // property strip's status chip (AtlasCardPropertyStrip.tsx), not a
    // plain field row -- present, but genuinely blank, never silently
    // defaulted to one of its own options.
    const statusChip = overlay.locator('[data-testid="atlas-page-status-chip"]')
    await expect(statusChip).toBeVisible()
    await expect(statusChip).toHaveText('')

    await deleteViaPageMenu(page, overlay)
    await expect(overlay).not.toBeVisible()
  })
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('a Kind-creation failure leaves the dialog open with an error and creates no cards', async ({}, testInfo) => {
  await withServer(testInfo, async (page) => {
    await page.getByTestId('atlas-add-from-folder').click()
    await expect(dialog(page)).toBeVisible()

    const filesGroup = dialog(page).getByTestId('atlas-folder-import-group').filter({ has: page.getByText('Files', { exact: true }) })
    await filesGroup.getByTestId('atlas-folder-import-kind').selectOption({ label: 'Create a new type from these files' })
    const panel = filesGroup.getByTestId('atlas-kind-proposal')
    await expect(panel).toBeVisible()

    // An empty type name isn't caught by the name-collision guard (no
    // name to collide with), so Confirm stays enabled and the failure
    // is a genuine server-side rejection (atlas.ValidateKind requires
    // a non-empty label) -- this is what proves Kind-creation-before-
    // import ordering: the failure must surface before ANY card exists.
    await panel.getByTestId('atlas-kind-proposal-name').fill('')

    const confirmButton = dialog(page).getByRole('button', { name: /Add \d+ cards/ })
    await confirmButton.click()
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).getByTestId('atlas-folder-import-error')).toBeVisible()
    await expect(noteCard(page, 'Ticket 1')).toHaveCount(0)

    // Recovery: a valid name on the very same panel succeeds.
    await panel.getByTestId('atlas-kind-proposal-name').fill('Recovered Ticket Type')
    await confirmButton.click()
    await expect(dialog(page)).not.toBeVisible()
    await expect(noteCard(page, 'Ticket 1')).toBeVisible()
  })
})
