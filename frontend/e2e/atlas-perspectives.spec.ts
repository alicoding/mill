import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ATLAS_PERSPECTIVES_MCP_BASE_PORT,
  ATLAS_PERSPECTIVES_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { contextMenu } from './fixtures/contextMenu'
import { clickBreadcrumbSegment, groupCard, noteCard, openCard } from './fixtures/atlasBoard'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { ATLAS_KIND_TOPIC, selectKind } from './fixtures/kindPicker'

// Perspectives (ADR-0041, goal 0095): the switcher (which absorbed the
// old Lens popover), board membership filtering incl. the ancestry-
// closure and link rules, arrange-disabled-while-active, authoring-
// adds-to-active, membership editing from both the board's context
// menu and the card page (slice 2), and the Compare diff view over the
// seeded reference-architecture example (slice 3). The active
// perspective is GLOBAL Atlas session state
// (AtlasSessionState.activePerspectiveID) and every perspective record
// is read by every board render -- its own dedicated server pair
// (fixtures/server.ts's ATLAS_PERSPECTIVES_* ports), never the shared
// worker pool (testing.md's shared-vs-dedicated rule).
//
// Runs against the seeded "My space" tree (internal/domain/atlas/
// builtin.go): My space (root) holds Getting started, Scratchpad,
// Example area (which holds Ada Lovelace and Project charter), and
// perspectives are user-authored (none ship seeded); each test
// builds what it asserts.
// link connects Getting started -> Ada Lovelace.

async function withServer(testInfo: { parallelIndex: number }, run: (page: Awaited<ReturnType<import('@playwright/test').Browser['newPage']>>) => Promise<void>): Promise<void> {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-atlas-perspectives-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = ATLAS_PERSPECTIVES_SERVER_BASE_PORT + idx
  const mcpPort = ATLAS_PERSPECTIVES_MCP_BASE_PORT + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({ port, mcpPort, settingsPath, executionDbPath, backupDir })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(page.getByTestId('atlas-board')).toBeVisible()
    await run(page)
  } finally {
    await browser.close()
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
}

const switcherButton = (page: import('@playwright/test').Page) => page.getByTestId('atlas-perspective-switcher-open')
const switcherPopover = (page: import('@playwright/test').Page) => page.getByTestId('atlas-perspective-switcher-popover')

async function createPerspective(page: import('@playwright/test').Page, name: string): Promise<void> {
  await switcherButton(page).click()
  await expect(switcherPopover(page)).toBeVisible()
  await page.getByTestId('atlas-perspective-new-input').fill(name)
  await page.getByTestId('atlas-perspective-new-input').press('Enter')
  await expect(switcherButton(page)).toHaveText(name)
}

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('create, switch, and rename a perspective via the switcher', async ({}, testInfo) => {
  await withServer(testInfo, async (page) => {
    // "Draft", never "Current" -- the seeded reference-architecture
    // example (goal 0095 slice 3) already seeds a perspective named
    // "Current", and this test's own creation must not collide with
    // it in the same popover.
    await createPerspective(page, 'Draft')

    // Switch back to All cards: the switcher label reverts and the
    // popover's own "All cards" row reads selected.
    await switcherButton(page).click()
    await switcherPopover(page).getByText('All cards', { exact: true }).click()
    await expect(switcherButton(page)).toHaveText('All cards')

    // Switch back to the created perspective by name.
    await switcherButton(page).click()
    await switcherPopover(page).getByText('Draft', { exact: true }).click()
    await expect(switcherButton(page)).toHaveText('Draft')

    // Rename inline via the row's own right-click menu.
    await switcherButton(page).click()
    await switcherPopover(page).getByText('Draft', { exact: true }).click({ button: 'right' })
    await expect(contextMenu(page)).toBeVisible()
    await contextMenu(page).getByText('Rename', { exact: true }).click()
    const renameInput = page.getByTestId('atlas-perspective-rename-input')
    await expect(renameInput).toBeVisible()
    await renameInput.fill('Renamed')
    await renameInput.press('Enter')
    await expect(switcherButton(page)).toHaveText('Renamed')
  })
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('a perspective filters the board to its members closed under ancestry, and hides a link whose endpoint is filtered out; Auto-arrange disables while active', async ({}, testInfo) => {
  await withServer(testInfo, async (page) => {
    await createPerspective(page, 'Filtered')

    // Nothing is a member yet -- the board renders empty.
    await expect(noteCard(page, 'Getting started')).not.toBeVisible()
    await expect(noteCard(page, 'Scratchpad')).not.toBeVisible()
    await expect(groupCard(page, 'Example area')).not.toBeVisible()

    // Arrange-disabled-while-active (ADR-0041): aria-disabled + the
    // exact tooltip copy, re-enabled once back on All cards.
    const arrange = page.getByTestId('atlas-auto-arrange')
    await expect(arrange).toHaveAttribute('aria-disabled', 'true')
    await expect(arrange).toHaveAttribute('title', 'Arranging works on all cards. Switch to All cards first.')

    // Switch to All cards to reach "Getting started" and add it via
    // the board's own right-click "Add to perspective".
    await switcherButton(page).click()
    await switcherPopover(page).getByText('All cards', { exact: true }).click()
    await expect(arrange).not.toHaveAttribute('aria-disabled', 'true')

    await noteCard(page, 'Getting started').click({ button: 'right' })
    await expect(contextMenu(page)).toBeVisible()
    await contextMenu(page).getByText('Add to perspective', { exact: false }).click()
    await expect(contextMenu(page)).toBeVisible()
    await contextMenu(page).getByText('Filtered', { exact: true }).click()
    await expect(page.getByTestId('atlas-quiet-toast')).toContainText('Added to Filtered')

    // Reach "Ada Lovelace" (nested inside Example area) and add her via
    // her own card page's membership chip -- still on All cards.
    await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
    await openCard(page, noteCard(page, 'Ada Lovelace'))
    const overlay = page.locator('[data-component="atlas-card-overlay"]')
    await expect(overlay).toBeVisible()
    // The add menu's own ActionMenu.Overlay portals outside the
    // Dialog's DOM subtree (the same reason fixtures/atlasPage.ts's
    // deleteViaPageMenu queries the kebab's menu item off `page`, not
    // `overlay`) -- the item is queried off `page` here too.
    await overlay.getByTestId('atlas-page-perspective-add').click()
    await page.getByRole('menuitem', { name: 'Filtered', exact: true }).click()
    await expect(overlay.getByTestId('atlas-page-perspective-membership')).toContainText('Filtered')
    await page.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()
    await clickBreadcrumbSegment(page, page.getByTestId('atlas-breadcrumb').getByText('My space', { exact: true }), 'My space')

    // Switch to Filtered: Getting started (direct add) AND Example area
    // (ancestry closure from Ada's own add) both render; Project
    // charter (Ada's sibling, never added) and the seeded Getting
    // started -> Ada Lovelace link (never made a perspective member
    // itself) both stay hidden -- the endpoint-visibility half of the
    // link rule already covers this: Ada's own top-level ancestor
    // (Example area) IS visible here, but the raw link record was
    // never added to Filtered's own MemberLinkIDs.
    await switcherButton(page).click()
    await switcherPopover(page).getByText('Filtered', { exact: true }).click()
    await expect(noteCard(page, 'Getting started')).toBeVisible()
    await expect(groupCard(page, 'Example area')).toBeVisible()
    await expect(noteCard(page, 'Scratchpad')).not.toBeVisible()
    await expect(page.locator('.react-flow__edge')).toHaveCount(0)

    await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
    await expect(noteCard(page, 'Ada Lovelace')).toBeVisible()
    await expect(noteCard(page, 'Project charter')).not.toBeVisible()
  })
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('authoring a card while a perspective is active adds it automatically; the edit reflects after switching back (the O(1) property)', async ({}, testInfo) => {
  await withServer(testInfo, async (page) => {
    await createPerspective(page, 'Authoring')

    const title = 'ZzE2ePerspectiveAuthored'
    await page.getByTestId('atlas-add-button').click()
    await page.getByTestId('atlas-add-child').click()
    await selectKind(page, ATLAS_KIND_TOPIC, 'atlas-create-kind')
    await page.getByTestId('atlas-create-title').fill(title)
    await page.getByRole('button', { name: 'Create' }).click()

    // Authoring-adds-to-active (server-side, keyed off the session's
    // own ActivePerspectiveID) -- the new card renders immediately on
    // the still-filtered board, no separate add step.
    const newCard = noteCard(page, title)
    await expect(newCard).toBeVisible()

    // Edit it while the perspective is still active.
    await openCard(page, newCard)
    const overlay = page.locator('[data-component="atlas-card-overlay"]')
    await overlay.getByTestId('atlas-page-note').fill('Edited while a perspective was active.')
    await overlay.getByTestId('atlas-page-note').blur()
    await expect(overlay.getByTestId('atlas-page-saved-tick')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()

    // One record, every view: the same edit shows on All cards too.
    await switcherButton(page).click()
    await switcherPopover(page).getByText('All cards', { exact: true }).click()
    await openCard(page, newCard)
    await expect(page.getByTestId('atlas-page-note')).toHaveValue('Edited while a perspective was active.')

    // Cleanup (testing.md's within-file discipline) -- overlay already open.
    await deleteViaPageMenu(page, page.locator('[data-component="atlas-card-overlay"]'))
    await expect(newCard).toHaveCount(0)
  })
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('membership removes via the board context menu, and deleting a perspective returns the board to All cards', async ({}, testInfo) => {
  await withServer(testInfo, async (page) => {
    await createPerspective(page, 'Removable')

    await switcherButton(page).click()
    await switcherPopover(page).getByText('All cards', { exact: true }).click()
    await noteCard(page, 'Scratchpad').click({ button: 'right' })
    await expect(contextMenu(page)).toBeVisible()
    await contextMenu(page).getByText('Add to perspective', { exact: false }).click()
    await contextMenu(page).getByText('Removable', { exact: true }).click()
    await expect(page.getByTestId('atlas-quiet-toast')).toContainText('Added to Removable')

    await switcherButton(page).click()
    await switcherPopover(page).getByText('Removable', { exact: true }).click()
    await expect(noteCard(page, 'Scratchpad')).toBeVisible()

    await noteCard(page, 'Scratchpad').click({ button: 'right' })
    await expect(contextMenu(page)).toBeVisible()
    await contextMenu(page).getByText('Remove from perspective', { exact: false }).click()
    await contextMenu(page).getByText('Removable', { exact: true }).click()
    await expect(page.getByTestId('atlas-quiet-toast')).toContainText('Removed from Removable')
    await expect(noteCard(page, 'Scratchpad')).not.toBeVisible()

    // Delete the perspective: blocked-delete-with-confirm posture --
    // ConfirmDialog names it, confirming lands back on All cards.
    await switcherButton(page).click()
    await switcherPopover(page).getByText('Removable', { exact: true }).click({ button: 'right' })
    await expect(contextMenu(page)).toBeVisible()
    await contextMenu(page).getByText('Delete', { exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Delete Removable?' })).toBeVisible()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(switcherButton(page)).toHaveText('All cards')
    await expect(noteCard(page, 'Scratchpad')).toBeVisible()
  })
})

// Compare is proven over a USER-authored pair of perspectives -- no
// perspective ships seeded (concepts are the user's; only the
// capability ships). Link-level diff semantics stay proven at the Go
// layer (DiffPerspectives' own tests); this flow pins the UI: author,
// diff, and the empty-group omission.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Compare shows the diff between two user-authored perspectives', async ({}, testInfo) => {
  await withServer(testInfo, async (page) => {
    // No perspectives ship: the switcher opens with only "All cards"
    // and the create affordance.
    await switcherButton(page).click()
    await expect(switcherPopover(page).getByText('All cards', { exact: true })).toBeVisible()
    await expect(switcherPopover(page).getByText('Compare perspectives', { exact: false })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await createPerspective(page, 'Before')
    await createPerspective(page, 'After')

    // "After" is active (creation activates): authoring joins it.
    const oldTitle = 'ZzE2eCompareOld'
    const newTitle = 'ZzE2eCompareNew'
    for (const title of [oldTitle, newTitle]) {
      await page.getByTestId('atlas-add-button').click()
      await page.getByTestId('atlas-add-child').click()
      await selectKind(page, ATLAS_KIND_TOPIC, 'atlas-create-kind')
      await page.getByTestId('atlas-create-title').fill(title)
      await page.getByRole('button', { name: 'Create' }).click()
      await expect(noteCard(page, title)).toBeVisible()
    }

    // The old card also joins "Before" via the context menu.
    await switcherButton(page).click()
    await switcherPopover(page).getByText('All cards', { exact: true }).click()
    await noteCard(page, oldTitle).click({ button: 'right' })
    await expect(contextMenu(page)).toBeVisible()
    await contextMenu(page).getByText('Add to perspective', { exact: false }).click()
    await expect(contextMenu(page)).toBeVisible()
    await contextMenu(page).getByText('Before', { exact: true }).click()
    await expect(page.getByTestId('atlas-quiet-toast')).toContainText('Added to Before')

    // Compare Before -> After: the new card is the one addition; no
    // removed groups render (empty groups are omitted).
    await switcherButton(page).click()
    await switcherPopover(page).getByText('Compare perspectives', { exact: false }).click()
    const dialog = page.locator('[data-component="atlas-perspective-compare-dialog"]')
    await expect(dialog).toBeVisible()
    await dialog.getByTestId('atlas-compare-from').selectOption({ label: 'Before' })
    await dialog.getByTestId('atlas-compare-to').selectOption({ label: 'After' })

    const results = dialog.getByTestId('atlas-compare-results')
    await expect(results.getByText('Added cards (1)', { exact: true })).toBeVisible()
    await expect(results.getByTestId('atlas-compare-card-row').filter({ hasText: newTitle })).toBeVisible()
    await expect(dialog.getByText('Removed cards', { exact: false })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()

    // Cleanup (within-file discipline): cards, then perspectives.
    for (const title of [oldTitle, newTitle]) {
      await openCard(page, noteCard(page, title))
      await deleteViaPageMenu(page, page.locator('[data-component="atlas-card-overlay"]'))
    }
    for (const name of ['Before', 'After']) {
      await switcherButton(page).click()
      const row = switcherPopover(page).getByText(name, { exact: true })
      await row.click({ button: 'right' })
      await contextMenu(page).getByText('Delete', { exact: true }).click()
      await expect(page.getByRole('heading', { name: `Delete ${name}?` })).toBeVisible()
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByRole('heading', { name: `Delete ${name}?` })).toHaveCount(0)
      if (await switcherPopover(page).isVisible()) await page.keyboard.press('Escape')
    }
  })
})
