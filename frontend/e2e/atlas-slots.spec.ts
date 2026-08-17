import { chromium, expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ATLAS_SLOTS_MCP_BASE_PORT,
  ATLAS_SLOTS_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { contextMenu } from './fixtures/contextMenu'
import { ATLAS_KIND_TOPIC, selectKind } from './fixtures/kindPicker'
import { clickCorner, noteCard, zoomAllTheWayOut } from './fixtures/atlasBoard'

// Atlas typed link slots (goal 0081 slice A4): the flip back face's
// slot-row block, slot-drag = instant link (release on a card) / no-op
// (release on the same card or a note) / guided-create (release on
// empty canvas), chip removal, quiet edges' hover-only label, and the
// edge/card context menus -- driven end to end against its own
// dedicated server (fixtures/server.ts's ATLAS_SLOTS_* ports), same
// own-server-own-ports reasoning as atlas-authoring/atlas-containment:
// this spec asserts exact edge/chip counts, which the standard
// per-worker pool can't guarantee stays uncontaminated by another spec
// file sharing that worker's server.
//
// A real MirrorPath-bearing card cannot be produced through the UI in
// this environment (no seeded card carries one, and setting it needs
// either a native OS file drop or a copied-file paste -- both already
// documented as unavailable to server-mode Playwright, goal 0081 A3's
// own residual). So the mirror-path-gated "Open file"/"Reveal in file
// manager" items are proven ABSENT on a plain card here; their
// presence on a real mirrored card is Go-level only
// (atlasservice_share_test.go) plus a manual desktop-mode check,
// same layering testing.md's manual-only registry already documents
// for other native-OS-only paths.

// Raw pointer drag (mousedown -> intermediate moves -> mouseup) --
// useAtlasSlotDrag.ts listens on window pointermove/pointerup, not
// React Flow's own node-drag or native HTML5 drag-and-drop, so
// Playwright's page.mouse sequence (the same technique atlas-
// containment.spec.ts's own dragBetween established for the Area
// tool's marquee) is what actually exercises it.
async function dragBetween(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const steps = 12
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.waitForTimeout(50)
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
  }
  await page.mouse.up()
}

// The seeded space carries only one link kind (relates-to,
// builtin.go), so a card's own slot-row/anchor block always has
// exactly one row -- selected by its wildcard testid rather than the
// kind's own id, which this frontend package never hardcodes
// (ADR-0038 Decision 2).
function slotAnchor(card: Locator): Locator {
  return card.locator('[data-testid^="atlas-slot-anchor-"]').first()
}
function slotRow(card: Locator): Locator {
  return card.locator('[data-testid^="atlas-slot-row-"]').first()
}

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('atlas typed link slots: flip-face rows, slot-drag linking, chip removal, quiet edges, menus', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-atlas-slots-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = ATLAS_SLOTS_SERVER_BASE_PORT + idx
  const mcpPort = ATLAS_SLOTS_MCP_BASE_PORT + idx

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
    const menu = contextMenu(page)

    // The seeded space already carries its own root-level artery
    // ("Getting started" -> "Ada Lovelace" resolves to "Getting
    // started" <-> "Example area" at this depth, atlasLinkResolution.
    // ts's own cross-area aggregation) -- every edge-count assertion
    // below is relative to this baseline, never an absolute number,
    // so this spec never has to assume or fight the seed's own shape.
    const seededEdgeCount = await page.locator('.react-flow__edge').count()

    // --- Place two cards to link between ---
    for (const [title, corner] of [['ZzE2eSlotA', 'top-left'], ['ZzE2eSlotB', 'top-right']] as const) {
      await page.keyboard.press('c')
      await clickCorner(board, corner)
      await expect(popover).toBeVisible()
      await selectKind(popover, ATLAS_KIND_TOPIC)
      await popover.getByTestId('atlas-placement-title').fill(title)
      await popover.getByTestId('atlas-placement-submit').click()
      await expect(popover).not.toBeVisible()
      await expect(noteCard(page, title)).toBeVisible()
    }
    const cardA = noteCard(page, 'ZzE2eSlotA')
    const cardB = noteCard(page, 'ZzE2eSlotB')

    // --- Flip A: the slot rows block renders with a drag-to-add hint ---
    await cardA.click()
    await expect(cardA).toHaveAttribute('data-flipped', 'true')
    await expect(cardA.getByTestId('atlas-slot-rows')).toBeVisible()
    await expect(slotRow(cardA)).toContainText('drag to add')

    // --- Slot-drag onto another card = instant link, no popover ---
    // boundingBox() (unlike click()) never waits for CSS stability --
    // the flip's own 0.5s rotateY transition (AtlasNoteCardNode.module.
    // css) must settle before the anchor's on-screen coordinates are
    // real, and there's no DOM-observable transitionend signal
    // Playwright's own waiters can poll here.
    await page.waitForTimeout(600)
    const anchorBox = await slotAnchor(cardA).boundingBox()
    const targetBox = await cardB.boundingBox()
    if (!anchorBox || !targetBox) throw new Error('missing bounding box')
    await dragBetween(page,
      { x: anchorBox.x + anchorBox.width / 2, y: anchorBox.y + anchorBox.height / 2 },
      { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 })
    await expect(popover).not.toBeVisible()
    await expect(page.locator('.react-flow__edge')).toHaveCount(seededEdgeCount + 1)
    await expect(slotRow(cardA)).toContainText('ZzE2eSlotB')

    // --- The chip shows on the OTHER end too, prefixed as incoming ---
    await cardB.click()
    await expect(cardB).toHaveAttribute('data-flipped', 'true')
    await expect(slotRow(cardB)).toContainText('← ZzE2eSlotA')
    await cardB.click() // unflip

    // --- Quiet edges: label hidden by default, shown on hover ---
    // Scoped by data-hovered rather than a bare .atlas-link-label
    // count: every card's own slot row ALSO renders the same "relates
    // to" kind label text, and EdgeLabelRenderer's portal puts the
    // edge's own label outside the edge element's own DOM subtree, so
    // neither a text filter nor edge.locator(...) can disambiguate --
    // the [data-hovered] attribute this component drives is the one
    // stable, purpose-built signal.
    // .last(), not .first(): the seeded space's own baseline artery
    // (seededEdgeCount above) renders first in DOM order, this one
    // (freshly created) after it.
    const edge = page.locator('.react-flow__edge').last()
    const activeLabel = page.locator('.atlas-link-label[data-hovered="true"]')
    await expect(activeLabel).toHaveCount(0)
    await edge.hover()
    await expect(activeLabel).toHaveCount(1)
    await expect(activeLabel).toHaveCSS('opacity', '1')
    // A raw viewport corner risks the app's own sidebar/chrome; the
    // board's own corner is the reliably-empty point zoomAllTheWayOut
    // already established (clickCorner's own doc comment).
    const cornerBox = await board.boundingBox()
    if (!cornerBox) throw new Error('board has no bounding box')
    // steps: 20, not a single jump -- a one-shot page.mouse.move
    // reliably left the SVG edge's own mouseleave un-fired here
    // (reproduced twice); dragBetween's own multi-step technique is
    // what actually exercises real hover-transition handlers.
    await page.mouse.move(cornerBox.x + 12, cornerBox.y + 12, { steps: 20 })
    await expect(activeLabel).toHaveCount(0)

    // --- Edge right-click: Change link kind / Edit label / Remove link ---
    await edge.click({ button: 'right' })
    await expect(menu).toBeVisible()
    await expect(menu.getByText('Change link kind', { exact: true })).toBeVisible()
    await expect(menu.getByText('Remove link', { exact: true })).toBeVisible()
    await menu.getByText('Edit label…', { exact: true }).click()
    const labelInput = page.getByTestId('atlas-edge-label-input')
    await expect(labelInput).toBeVisible()
    await labelInput.fill('ZzE2eEdgeLabel')
    await labelInput.press('Enter')
    await expect(labelInput).not.toBeVisible()

    await edge.click({ button: 'right' })
    await expect(menu).toBeVisible()
    await menu.getByText('Remove link', { exact: true }).click()
    await expect(page.locator('.react-flow__edge')).toHaveCount(seededEdgeCount)
    // B's own earlier flip (to check its incoming chip) unflipped A --
    // only one card is ever flipped at a time.
    await cardA.click()
    await expect(cardA).toHaveAttribute('data-flipped', 'true')
    await expect(slotRow(cardA)).toContainText('drag to add')
    await page.waitForTimeout(600) // flip transition settle, see the comment above anchorBox's own first read

    // --- Chip's own × removal (re-create the link first) ---
    await dragBetween(page,
      { x: anchorBox.x + anchorBox.width / 2, y: anchorBox.y + anchorBox.height / 2 },
      { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 })
    await expect(page.locator('.react-flow__edge')).toHaveCount(seededEdgeCount + 1)
    await slotRow(cardA).getByTestId('atlas-slot-chip').locator('button').last().click()
    await expect(page.locator('.react-flow__edge')).toHaveCount(seededEdgeCount)
    await expect(slotRow(cardA)).toContainText('drag to add')

    // --- Release on empty canvas: guided create, card born already linked ---
    const boardBox = await board.boundingBox()
    if (!boardBox) throw new Error('board has no bounding box')
    // 0.5/0.85 (bottom-center) sits under the creation tray's own
    // chrome, which silently swallowed this card's later right-click
    // (reproduced: cleanup hung waiting on a context menu that never
    // opened) -- bottom-right instead, clear of both the tray and the
    // top corners clickCorner already claimed for cards A/B.
    await dragBetween(page,
      { x: anchorBox.x + anchorBox.width / 2, y: anchorBox.y + anchorBox.height / 2 },
      { x: boardBox.x + boardBox.width * 0.85, y: boardBox.y + boardBox.height * 0.85 })
    await expect(popover).toBeVisible()
    await selectKind(popover, ATLAS_KIND_TOPIC)
    await popover.getByTestId('atlas-placement-title').fill('ZzE2eSlotGuided')
    await popover.getByTestId('atlas-placement-submit').click()
    await expect(popover).not.toBeVisible()
    await expect(noteCard(page, 'ZzE2eSlotGuided')).toBeVisible()
    await expect(slotRow(cardA)).toContainText('ZzE2eSlotGuided')

    // --- Release on the same card / a note = no-op ---
    const sameCardBox = await cardA.boundingBox()
    if (!sameCardBox) throw new Error('missing bounding box')
    await dragBetween(page,
      { x: anchorBox.x + anchorBox.width / 2, y: anchorBox.y + anchorBox.height / 2 },
      { x: sameCardBox.x + sameCardBox.width / 2, y: sameCardBox.y + sameCardBox.height / 2 })
    await expect(popover).not.toBeVisible()
    await expect(page.locator('.react-flow__edge')).toHaveCount(seededEdgeCount + 1) // only the guided-create link from above

    // --- Card menu: kind-aware ordering + "Add linked card…" ---
    await cardA.click() // unflip
    await cardB.click({ button: 'right' })
    await expect(menu).toBeVisible()
    await expect(menu.getByText('Open file', { exact: true })).toHaveCount(0)
    await expect(menu.getByText('Reveal in file manager', { exact: true })).toHaveCount(0)
    await menu.getByText('Add linked card…', { exact: true }).click()
    await expect(popover).toBeVisible()
    await selectKind(popover, ATLAS_KIND_TOPIC)
    await popover.getByTestId('atlas-placement-title').fill('ZzE2eSlotAddLinked')
    await popover.getByTestId('atlas-placement-submit').click()
    await expect(popover).not.toBeVisible()
    await expect(noteCard(page, 'ZzE2eSlotAddLinked')).toBeVisible()
    await cardB.click()
    await expect(cardB).toHaveAttribute('data-flipped', 'true')
    await expect(slotRow(cardB)).toContainText('ZzE2eSlotAddLinked')
    await cardB.click()

    // Region chips (AtlasRegionChipNode) never render AtlasSlotRows at
    // all -- verified by source inspection (it's a different node
    // component that never imports it), not re-asserted here: the
    // seeded space has no nested area to reach one through without
    // constructing extra fixture state this spec doesn't otherwise need.

    // --- Within-file cleanup ---
    for (const title of ['ZzE2eSlotA', 'ZzE2eSlotB', 'ZzE2eSlotGuided', 'ZzE2eSlotAddLinked']) {
      await noteCard(page, title).click({ button: 'right' })
      await expect(menu).toBeVisible()
      await menu.getByText('Delete', { exact: true }).click()
      await page.getByRole('button', { name: 'Delete' }).click()
      await expect(noteCard(page, title)).toHaveCount(0)
    }
  } finally {
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
