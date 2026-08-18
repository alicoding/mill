import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ATLAS_AUTHORING_MCP_BASE_PORT,
  ATLAS_AUTHORING_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { contextMenu, rightClickEmptyArea } from './fixtures/contextMenu'
import { ATLAS_KIND_CONTACT, ATLAS_KIND_TOPIC, selectKind } from './fixtures/kindPicker'
import { clickCorner, groupCard, noteCard, submitCreatePopover, zoomAllTheWayOut } from './fixtures/atlasBoard'

// Atlas creation core (goal 0081 slice A1): the tray, its placement
// popover, right-click create, sticky notes, and the note promotion
// ritual -- driven end to end against the seeded "My space" ("Getting
// started", "Example area", "Scratchpad") and "Example area" ("Ada
// Lovelace", a mirrored Document) space (internal/domain/atlas/
// builtin.go). Runs on its own dedicated server (fixtures/server.ts's
// ATLAS_AUTHORING_* ports), not the standard per-worker pool: this
// spec asserts EXACT coverage counts at "My space", which must never
// be contaminated by another spec file sharing a worker's server.

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('atlas creation core: tray, placement popover, right-click create, sticky notes, promotion', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-atlas-authoring-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = ATLAS_AUTHORING_SERVER_BASE_PORT + idx
  const mcpPort = ATLAS_AUTHORING_MCP_BASE_PORT + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({ port, mcpPort, settingsPath, executionDbPath, backupDir })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Atlas' }).click()
    const board = page.getByTestId('atlas-board')
    await expect(board).toBeVisible()
    await zoomAllTheWayOut(page)

    // --- Tray renders ---
    await expect(page.getByTestId('atlas-creation-tray')).toBeVisible()
    const cardTool = page.getByTestId('atlas-tray-card')
    const noteTool = page.getByTestId('atlas-tray-note')
    await expect(cardTool).toBeVisible()
    await expect(noteTool).toBeVisible()

    const popover = page.getByTestId('atlas-placement-popover')

    // --- N -> click -> type -> blur -> sticky renders, unmistakably annotation ---
    await page.keyboard.press('n')
    await expect(noteTool).toHaveAttribute('data-armed', 'true')
    await clickCorner(board, 'top-left')
    await expect(noteTool).toHaveAttribute('data-armed', 'false')
    const draftTextarea = page.getByTestId('atlas-sticky-textarea')
    await expect(draftTextarea).toBeVisible()
    await draftTextarea.fill('ZzE2eStickyNoteText')
    await draftTextarea.blur()
    await expect(draftTextarea).toHaveCount(0)
    const sticky = page.getByTestId('atlas-sticky-note').filter({ hasText: 'ZzE2eStickyNoteText' })
    await expect(sticky).toBeVisible()
    // Regression: one blur commits exactly ONE note (the same
    // StrictMode updater-side-effect class as the card popover).
    await expect(sticky).toHaveCount(1)
    // No kind chip (a card's own front face always renders one) and a
    // distinct node type from a card.
    await expect(sticky.locator('[data-testid="atlas-note-file-tag"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="atlas-note-card"]').filter({ hasText: 'ZzE2eStickyNoteText' })).toHaveCount(0)

    // --- Exclusions, checked NOW while "My space" still holds only its
    // three seeded children (a note never joins that count) ---
    await page.keyboard.press('Meta+k')
    await expect(page.getByTestId('atlas-jump-results')).toBeVisible()
    await page.getByTestId('atlas-jump-input').fill('ZzE2eStickyNoteText')
    await expect(page.getByTestId('atlas-jump-result')).toHaveCount(0)
    await expect(page.getByTestId('atlas-jump-no-matches')).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByTestId('atlas-open-coverage').click()
    const coverageDialog = page.locator('[data-component="atlas-coverage-dialog"]')
    await expect(coverageDialog).toBeVisible()
    await expect(coverageDialog.getByTestId('atlas-coverage-link-value')).toHaveText('1/3 linked')
    await expect(coverageDialog.getByTestId('atlas-coverage-mirror-value')).toHaveText('0/3 mirrored')
    await page.keyboard.press('Escape')
    await expect(coverageDialog).not.toBeVisible()

    await page.getByTestId('atlas-open-matrix').click()
    const matrixDialog = page.locator('[data-component="atlas-matrix-dialog"]')
    await expect(matrixDialog).toBeVisible()
    await expect(matrixDialog).not.toContainText('ZzE2eStickyNoteText')
    await page.keyboard.press('Escape')
    await expect(matrixDialog).not.toBeVisible()

    // --- Right-click pane menu shows Add card/Add note above the
    // dialog-based "Add card…" -- top-center stays empty: content sits
    // vertically centered after zoomAllTheWayOut, the sticky note is in
    // the top-left corner, React Flow's own bottom-left Controls and
    // bottom-right attribution link stay clear of it entirely. ---
    const menuBox = await board.boundingBox()
    if (!menuBox) throw new Error('board has no bounding box')
    await rightClickEmptyArea(board, { x: menuBox.width / 2, y: 12 })
    const menu = contextMenu(page)
    await expect(menu).toBeVisible()
    await expect(menu.getByText('Add card', { exact: true })).toBeVisible()
    await expect(menu.getByText('Add note', { exact: true })).toBeVisible()
    // Regression: the old dialog-based "Add card…" item is superseded
    // by direct placement (goal 0081 slice A2 rider b) and must never
    // reappear in the pane menu.
    await expect(menu.getByText('Add card…', { exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(menu).not.toBeVisible()

    // --- Promote: right-click the note itself -> title prefilled from
    // its text -> confirm -> card exists at the same position, note
    // gone ---
    await sticky.click({ button: 'right' })
    await expect(menu).toBeVisible()
    await menu.getByText('Promote to card…', { exact: true }).click()
    await expect(popover).toBeVisible()
    await expect(popover.getByTestId('atlas-placement-title')).toHaveValue('ZzE2eStickyNoteText')
    await selectKind(popover, ATLAS_KIND_TOPIC)
    await popover.getByTestId('atlas-placement-submit').click()
    await expect(popover).not.toBeVisible()
    await expect(noteCard(page, 'ZzE2eStickyNoteText')).toBeVisible()
    await expect(page.getByTestId('atlas-sticky-note').filter({ hasText: 'ZzE2eStickyNoteText' })).toHaveCount(0)

    // --- C -> click -> popover -> choose kind + type title -> card
    // appears -- top-right, still clear of the promoted card sitting
    // in the top-left corner. ---
    await page.keyboard.press('c')
    await expect(cardTool).toHaveAttribute('data-armed', 'true')
    await clickCorner(board, 'top-right')
    await expect(cardTool).toHaveAttribute('data-armed', 'false')
    await expect(popover).toBeVisible()

    // The create loop (goal 0106 slice B contract item 4: C -> click ->
    // title -> Enter -> board) audited: the popover's own resting chrome
    // is the kind chip + title input ONLY -- no "Kind"/"Title" labels,
    // no visible Submit/Cancel row (Enter/Escape are the only commit/
    // cancel paths). The title input is already focused.
    await expect(popover.getByText('Kind', { exact: true })).toHaveCount(0)
    await expect(popover.getByText('Title', { exact: true })).toHaveCount(0)
    await expect(popover.getByTestId('atlas-placement-submit')).toHaveCount(0)
    await expect(popover.getByTestId('atlas-placement-cancel')).toHaveCount(0)
    await expect(popover.getByTestId('atlas-placement-title')).toBeFocused()

    await selectKind(popover, ATLAS_KIND_TOPIC)
    await popover.getByTestId('atlas-placement-title').fill('ZzE2eRootCard')
    await submitCreatePopover(popover)
    await expect(popover).not.toBeVisible()
    await expect(noteCard(page, 'ZzE2eRootCard')).toBeVisible()
    // Regression: one confirm creates exactly ONE card. StrictMode
    // double-invokes setState updater functions, so a service call
    // living inside one fires twice -- every C-flow confirm produced
    // duplicate cards until the call moved out of the updater.
    await expect(noteCard(page, 'ZzE2eRootCard')).toHaveCount(1)

    // --- After zooming into an area, repeat -> the new card's parent
    // IS that area, not root: "Example area" seeds exactly 2 children
    // (Ada Lovelace, the mirrored Document), so its own header count
    // goes 2 -> 3. (A one-level-deep preview of the SAME card also
    // renders inside the frame back at root -- that's the board's own
    // documented nesting behavior, not evidence either way, so the
    // header's own count is the real proof here, not the card's mere
    // presence/absence at root.)
    const exampleArea = groupCard(page, 'Example area')
    await expect(exampleArea.getByTestId('atlas-group-header')).toContainText('2 cards')
    await exampleArea.getByTestId('atlas-group-header').click()
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')
    await zoomAllTheWayOut(page)
    await page.keyboard.press('c')
    await clickCorner(board, 'top-left')
    await expect(popover).toBeVisible()
    await selectKind(popover, ATLAS_KIND_CONTACT)
    await popover.getByTestId('atlas-placement-title').fill('ZzE2eAreaCard')
    await submitCreatePopover(popover)
    await expect(popover).not.toBeVisible()
    await expect(noteCard(page, 'ZzE2eAreaCard')).toBeVisible()

    await page.keyboard.press('Meta+ArrowUp')
    await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('Example area')
    await expect(exampleArea.getByTestId('atlas-group-header')).toContainText('3 cards')

    // --- Within-file cleanup: delete every card created above (goal
    // 0093: instant, no confirm) ---
    for (const title of ['ZzE2eStickyNoteText', 'ZzE2eRootCard']) {
      await noteCard(page, title).click({ button: 'right' })
      await expect(menu).toBeVisible()
      await menu.getByText('Delete', { exact: true }).click()
      await expect(noteCard(page, title)).toHaveCount(0)
    }
    await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
    await noteCard(page, 'ZzE2eAreaCard').click({ button: 'right' })
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
    await expect(noteCard(page, 'ZzE2eAreaCard')).toHaveCount(0)
  } finally {
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
