import { chromium, expect, test } from '@playwright/test'
import { blurSticky, fillSticky, stickyEditor } from './fixtures/codeEditor'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ATLAS_LINKING_MCP_BASE_PORT,
  ATLAS_LINKING_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { ATLAS_KIND_TOPIC } from './fixtures/kindPicker'
import { clickCorner, dragBetween, noteCard, zoomAllTheWayOut } from './fixtures/atlasBoard'

// Atlas linking interaction overhaul (goal 0124 slice 2): drop-anywhere
// targeting (a release anywhere on a highlighted candidate's own
// bounds connects, not just its center/handle), the edge hover chip's
// own Delete/Change-kind pair, the drop-refusal hint, and the kind-
// picker dropdown's anchored positioning -- driven end to end against
// its own dedicated server (fixtures/server.ts's ATLAS_LINKING_*
// ports), same own-server-own-ports reasoning as atlas-slots: this
// spec asserts exact edge counts, which the standard per-worker pool
// can't guarantee stays uncontaminated by another spec file sharing
// that worker's server.

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('atlas linking: drop-anywhere targeting, hover chip, refusal hint, anchored kind dropdown', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-atlas-linking-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = ATLAS_LINKING_SERVER_BASE_PORT + idx
  const mcpPort = ATLAS_LINKING_MCP_BASE_PORT + idx

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

    const popover = page.getByTestId('atlas-placement-popover')
    const seededEdgeCount = await page.locator('.react-flow__edge').count()
    const boardBox = await board.boundingBox()
    if (!boardBox) throw new Error('board has no bounding box')

    // --- Kind-picker dropdown: opens anchored to its own trigger, not
    // detached/offset (goal 0124's own regression) -- the overlay's
    // bounding box sits directly adjoining the trigger's. Run before
    // any card/note placement below, while every corner is still
    // empty (zoomAllTheWayOut shrinks existing/seeded content toward
    // the board's CENTER, per clickCorner's own doc comment -- the
    // corners are the empty margin, not the middle). ---
    // (goal 0144: the card-create popover is gone -- the kind picker's
    // anchoring check runs against the New space dialog's instance of
    // the SAME component.)
    await page.getByTestId('atlas-board').click({ button: 'right', position: { x: 180, y: 420 } })
    await page.getByText('New space…', { exact: true }).click()
    const kindTrigger = page.getByTestId('atlas-create-kind')
    const triggerBox = await kindTrigger.boundingBox()
    if (!triggerBox) throw new Error('missing kind trigger bounding box')
    await kindTrigger.click()
    const kindOption = page.getByTestId(`atlas-create-kind-option-${ATLAS_KIND_TOPIC}`)
    await expect(kindOption).toBeVisible()
    const overlayBox = await page.getByRole('listbox').boundingBox()
    if (!overlayBox) throw new Error('missing kind overlay bounding box')
    // Anchored, not detached: the overlay's top sits at (or just
    // below) the trigger's own bottom edge, and their horizontal
    // spans overlap -- a "drew on top of/offset from its trigger"
    // regression would fail either check.
    expect(overlayBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height - 1)
    expect(overlayBox.y).toBeLessThan(triggerBox.y + triggerBox.height + 20)
    expect(overlayBox.x).toBeLessThan(triggerBox.x + triggerBox.width)
    expect(overlayBox.x + overlayBox.width).toBeGreaterThan(triggerBox.x)
    await kindTrigger.click()
    await expect(kindOption).not.toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()

    // --- Place two cards to link between ---
    await page.evaluate((kindID) => localStorage.setItem('atlas.lastKindId', kindID), ATLAS_KIND_TOPIC)
    for (const [title, corner] of [['ZzE2eLinkA', 'top-left'], ['ZzE2eLinkB', 'top-right']] as const) {
      await page.keyboard.press('c')
      await clickCorner(board, corner)
      const inline = page.getByTestId('atlas-inline-title')
      await expect(inline).toBeVisible()
      await inline.fill(title)
      await inline.press('Enter')
      await expect(inline).toHaveCount(0)
      await expect(noteCard(page, title)).toBeVisible()
    }
    const cardA = noteCard(page, 'ZzE2eLinkA')
    const cardB = noteCard(page, 'ZzE2eLinkB')
    const handleA = cardA.getByTestId('atlas-note-link-handle')

    // --- Drop-anywhere targeting: releasing over the target's EDGE
    // region (its own top-left corner, well off its center) still
    // connects -- the highlighted candidate's FULL bounds are the
    // real target, not a center point or its own handle. ---
    const anchorBox = await handleA.boundingBox()
    const targetBox = await cardB.boundingBox()
    if (!anchorBox || !targetBox) throw new Error('missing bounding box')
    const targetEdge = { x: targetBox.x + 6, y: targetBox.y + 6 }
    await dragBetween(page, { x: anchorBox.x + anchorBox.width / 2, y: anchorBox.y + anchorBox.height / 2 }, targetEdge)
    await expect(popover).not.toBeVisible()
    await expect(page.locator('.react-flow__edge')).toHaveCount(seededEdgeCount + 1)

    // --- Repeat the identical drag: idempotent (slice 1's own
    // uniqueness, proven through the drag UI here) -- count stays put. ---
    await dragBetween(page, { x: anchorBox.x + anchorBox.width / 2, y: anchorBox.y + anchorBox.height / 2 }, targetEdge)
    await expect(page.locator('.react-flow__edge')).toHaveCount(seededEdgeCount + 1)

    // --- Hover the edge: the chip appears; Delete removes the link ---
    const edge = page.locator('.react-flow__edge').last()
    const chip = page.locator('.atlas-link-chip[data-visible="true"]')
    await expect(chip).toHaveCount(0)
    await edge.hover()
    await expect(chip).toHaveCount(1)
    await chip.getByTestId('edge-delete').click()
    await expect(page.locator('.react-flow__edge')).toHaveCount(seededEdgeCount)

    // --- Drop-refusal hint: releasing on a Note (never a Link
    // endpoint -- a Note isn't a Card) shows the transient hint and
    // creates nothing. ---
    await page.keyboard.press('n')
    // Bottom-left, off both corner cards this test already placed and
    // the creation tray's own bottom-center chrome (clickCorner's own
    // doc comment on the board's reliably-empty regions).
    await board.click({ position: { x: boardBox.width * 0.15, y: boardBox.height * 0.85 } })
    await expect(stickyEditor(page)).toBeVisible()
    await fillSticky(page, 'ZzE2eLinkNote')
    await blurSticky(page)
    const stickyNote = page.getByTestId('atlas-sticky-note').filter({ hasText: 'ZzE2eLinkNote' })
    await expect(stickyNote).toBeVisible()
    const noteBox = await stickyNote.boundingBox()
    if (!noteBox) throw new Error('missing note bounding box')

    const refusalHint = page.getByTestId('atlas-link-refusal-hint')
    await expect(refusalHint).toHaveCount(0)
    await dragBetween(page,
      { x: anchorBox.x + anchorBox.width / 2, y: anchorBox.y + anchorBox.height / 2 },
      { x: noteBox.x + noteBox.width / 2, y: noteBox.y + noteBox.height / 2 })
    await expect(refusalHint).toBeVisible()
    await expect(refusalHint).toHaveText("Not linked: Topic and Note can't be linked here.")
    await expect(page.locator('.react-flow__edge')).toHaveCount(seededEdgeCount) // no link created

    // --- Handle honesty: the source handle stays in the DOM but
    // reports disabled state via its own attribute + title when a
    // board has nothing else it could link to is covered by source
    // inspection (atlasBuildBoardNodes.ts's hasLegalTargets, wired
    // through unconditionally) rather than re-proven here: reaching
    // that state needs an isolated single-card board this dedicated
    // server's own seed doesn't provide without deleting content
    // other assertions in this file still depend on.

    // --- Within-file cleanup (goal 0093: instant, no confirm) ---
    const menu = page.getByTestId('context-menu')
    for (const title of ['ZzE2eLinkA', 'ZzE2eLinkB']) {
      await noteCard(page, title).click({ button: 'right' })
      await expect(menu).toBeVisible()
      await menu.getByText('Delete', { exact: true }).click()
      await expect(noteCard(page, title)).toHaveCount(0)
    }
    await stickyNote.click({ button: 'right' })
    await expect(menu).toBeVisible()
    await menu.getByText('Delete note', { exact: true }).click()
    await expect(stickyNote).toHaveCount(0)
  } finally {
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
