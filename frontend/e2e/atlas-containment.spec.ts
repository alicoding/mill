import { chromium, expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ATLAS_CONTAINMENT_MCP_BASE_PORT,
  ATLAS_CONTAINMENT_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { contextMenu } from './fixtures/contextMenu'
import { ATLAS_KIND_TOPIC, selectKind } from './fixtures/kindPicker'
import { armAndPlaceTopicCard, boardPoint, deleteCardViaMenu, dragBetween, groupCard, hittablePointOn, noteCard } from './fixtures/atlasBoard'
import { waitForViewportStable } from './fixtures/animation'
import { wheelAt } from './fixtures/pointer'

// A LIGHTER zoom-out than fixtures/atlasBoard.ts's own zoomAllTheWayOut
// (8 clicks): this spec right-clicks a frame's own narrow header/tile-
// grid gap (a small fraction of its own rendered height), which needs
// a legible on-screen size to hit reliably -- 8x zoom-out shrinks a
// two-tile frame to only a few CSS pixels tall. Fractional board-point
// placement (boardPoint below) still keeps every card/drag comfortably
// separated at this lighter zoom. Waits for React Flow's own JS-driven
// zoom transform to settle before returning -- testing.md's own
// interaction-race class, the same fixed-sleep-vs-poll race
// waitForViewportStable was promoted to fix elsewhere: a marquee drawn
// (or a bounding box read) while the transform is still interpolating
// races a camera position that hasn't landed yet.
async function zoomOutLight(page: import('@playwright/test').Page): Promise<void> {
  const zoomOut = page.locator('.react-flow__controls-zoomout')
  for (let i = 0; i < 3; i++) await zoomOut.click()
  await waitForViewportStable(page.getByTestId('atlas-board'))
}

// Atlas containment (goal 0081 slice A2): area drawing (draw-empty,
// marker-box), select-then-group, drag filing into/out of a frame,
// dissolve/delete's children-always-promote rule, and the
// context-aware frame menus -- driven end to end against a fresh
// seeded space (internal/domain/atlas/builtin.go), own dedicated
// server (fixtures/server.ts's ATLAS_CONTAINMENT_* ports) since this
// spec asserts exact frame child counts, same own-server-own-ports
// reasoning atlas-authoring.spec.ts already documents.

// dragBetween/boardPoint/hittablePointOn are the shared fixtures/atlasBoard.ts
// versions (this spec's own former local copies were promoted there,
// testing.md's promotion rule, once a third spec file needed the
// identical body). dragBetweenAssertingMidway below is this spec's own
// use of dragBetween's optional onArrived callback (goal 0161 slice 1's
// own regression coverage: the release-target highlight reaches the
// frame through a context channel now, decoupled from the board's
// node-array rebuild, and this proves that channel still delivers the
// same highlight at the same moment, mid-drag with the button still
// down).
async function dragBetweenAssertingMidway(page: Page, from: Parameters<typeof dragBetween>[1], to: Parameters<typeof dragBetween>[2], onArrived: () => Promise<void>): Promise<void> {
  await dragBetween(page, from, to, onArrived)
}

// FINDING (goal 0184 migration, CI-confirmed via trace.zip): PR #426's
// CI failure (3/3 deterministic timeouts, shard 4) traced to TWO
// distinct, genuinely-deterministic bugs in this migration -- not the
// Area tool's own pre-existing flakiness an earlier, noisier local
// investigation had wrongly blamed:
//
// 1. wheelAt(groupArea)'s DEFAULT hover point (groupArea's raw
//    geometric center) can sit under a member's own one-nesting-level
//    preview tile -- a real SIBLING React Flow node, not a DOM
//    descendant of groupArea, so it genuinely intercepts depending on
//    zoom/pan (trace named the exact covering node:
//    data-testid="rf__node-untitled-cc7e4c", MemberB's preview). Fixed
//    by anchoring both wheelAt calls on the frame's own header band
//    instead, which sits above every child/preview row.
// 2. `locator.hover({position})` requires the RESOLVED point to
//    actually be the given locator or its own descendant -- a
//    DragEndpoint whose position sits OUTSIDE that locator's own box
//    (a marquee corner drawn just past a card's edge, as this file's
//    "Rider (a)" step does) can never pass: elementFromPoint at that
//    point resolves to whatever's ACTUALLY there (the sibling
//    `.react-flow__pane`), not the locator, so the check fails 100% of
//    the time, not occasionally. Fixed by anchoring every marquee-corner
//    DragEndpoint on `board` (which genuinely contains the point)
//    instead of the card the corner is merely drawn relative to.
//
// Both fixes are below, at their own call sites. Neither bug is
// specific to the Area tool -- the earlier local diagnosis that
// blamed its own pointer-capture handling was most likely observing
// one of these same two bugs.
// Gesture-dense flow (10+ distinct interaction phases) already close to
// the default 60s budget on raw/unchecked input alone (atlas-select-
// group.spec.ts's own gesture-dense flow needed the same headroom, at
// test.setTimeout(180_000)) -- a modest bump keeps margin for the
// checked steps this file's other gestures now carry.
test.setTimeout(120_000)

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('atlas containment: area drawing, marker-box grouping, drag filing, dissolve, context menus @flaky', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-atlas-containment-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = ATLAS_CONTAINMENT_SERVER_BASE_PORT + idx
  const mcpPort = ATLAS_CONTAINMENT_MCP_BASE_PORT + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({ port, mcpPort, settingsPath, executionDbPath, backupDir })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Atlas' }).click()
    const board = page.getByTestId('atlas-board')
    await expect(board).toBeVisible()
    await zoomOutLight(page)

    const popover = page.getByTestId('atlas-placement-popover')
    const menu = contextMenu(page)

    // --- Draw empty: A -> drag a small marquee over open canvas ->
    // popover carries NO context line -> creates a plain (non-frame)
    // card. ---
    await page.keyboard.press('a')
    const areaTool = page.getByTestId('atlas-tray-area')
    await expect(areaTool).toHaveAttribute('data-armed', 'true')
    await dragBetween(page, await boardPoint(board, 0.02, 0.02), await boardPoint(board, 0.08, 0.08))
    await expect(areaTool).toHaveAttribute('data-armed', 'false')
    await expect(popover).toBeVisible()
    await expect(popover.getByTestId('atlas-placement-context')).toHaveCount(0)
    await selectKind(popover, ATLAS_KIND_TOPIC)
    await popover.getByTestId('atlas-placement-title').fill('ZzC2eEmptyArea')
    await popover.getByTestId('atlas-placement-submit').click()
    await expect(popover).not.toBeVisible()
    await expect(noteCard(page, 'ZzC2eEmptyArea')).toBeVisible()
    await expect(groupCard(page, 'ZzC2eEmptyArea')).toHaveCount(0)

    // --- Marker-box: place two cards, draw a marquee around both ->
    // "2 items move into this area" -> confirm -> a frame with 2
    // children. Placements stay >= 0.3 board-width fractions apart --
    // a card's own rendered footprint at this zoom level is wide
    // enough that a tighter gap lands a later click ON the earlier
    // card (selecting it) instead of on empty canvas. ---
    await armAndPlaceTopicCard(page, board, popover, 0.25, 0.05, 'ZzC2eMemberA')
    await armAndPlaceTopicCard(page, board, popover, 0.55, 0.05, 'ZzC2eMemberB')
    await page.keyboard.press('a')
    await dragBetween(page, await boardPoint(board, 0.18, 0.01), await boardPoint(board, 0.63, 0.16))
    await expect(popover).toBeVisible()
    await expect(popover.getByTestId('atlas-placement-context')).toHaveText('2 items move into this area')
    await selectKind(popover, ATLAS_KIND_TOPIC)
    await popover.getByTestId('atlas-placement-title').fill('ZzC2eGroupArea')
    await popover.getByTestId('atlas-placement-submit').click()
    await expect(popover).not.toBeVisible()
    // A one-nesting-level-deep preview of each member also renders
    // inside the frame at this same root level (the board's own
    // documented nesting behavior) -- the header's own count is the
    // real proof of containment, not the cards' mere presence/absence.
    const groupArea = groupCard(page, 'ZzC2eGroupArea')
    await expect(groupArea.getByTestId('atlas-group-header')).toContainText('2 items')

    // --- Frame interior: right-click the frame's own empty band
    // (below the header, above its tile grid -- never on the header
    // itself, never on a child) -> "Add card to ZzC2eGroupArea" ->
    // popover -> the new card lands inside (header count 2 -> 3). That
    // band is only ~12-18 flow units tall regardless of frame size (a
    // fixed layout constant, atlasBoardLayout.ts's own
    // GROUP_HEADER_INSET/GROUP_PADDING) -- rather than guess a
    // fraction of the frame's own rendered size, click a few real
    // CSS pixels below the header element's OWN measured bottom edge
    // (mild zoom-in first, centered on the frame's own header via a
    // wheel event so it stays on screen, since the zoom control
    // buttons re-center on the viewport's own middle and would carry
    // an off-center frame out of view). Anchored on the HEADER, not
    // groupArea's own raw center: a member's one-nesting-level preview
    // tile (goal 0161's own comment above) is a real SIBLING React Flow
    // node, not a DOM descendant of groupArea, and it can sit exactly
    // over that raw center depending on the current zoom/pan -- CI
    // caught this live, a real "intercepts pointer events" hang, not a
    // flake (goal 0184 migration fix). The header band sits above every
    // child/preview row, so it stays clear regardless of nesting.
    const header = groupArea.getByTestId('atlas-group-header')
    // ⌘-held: a bare wheel PANS under the default trackpad navigation
    // mode (goal 0257); ⌘-scroll is the mode-independent zoom gesture
    // (zoomActivationKeyCode), so this stays a zoom in both modes.
    await page.keyboard.down('Meta')
    await wheelAt(page, header, 0, -300)
    await page.keyboard.up('Meta')
    await waitForViewportStable(board)
    const headerBox = await header.boundingBox()
    const groupBox = await groupArea.boundingBox()
    if (!headerBox || !groupBox) throw new Error('missing bounding box after zooming in')
    await groupArea.click({ position: { x: 5, y: headerBox.y + headerBox.height + 3 - groupBox.y }, button: 'right' })
    await expect(menu).toBeVisible()
    await page.evaluate((kindID) => localStorage.setItem('atlas.lastKindId', kindID), ATLAS_KIND_TOPIC)
    await menu.getByText('Add card to ZzC2eGroupArea', { exact: true }).click()
    // Instant placement (goal 0144): the menu item creates the card
    // inside the frame; its preview tile's title edits inline.
    const interiorInline = page.getByTestId('atlas-inline-title')
    await expect(interiorInline).toBeVisible()
    await interiorInline.fill('ZzC2eInterior')
    await interiorInline.press('Enter')
    await expect(interiorInline).toHaveCount(0)
    // ⌘-held for the same goal-0257 reason as the zoom-in above.
    await page.keyboard.down('Meta')
    await wheelAt(page, header, 0, 300)
    await page.keyboard.up('Meta')
    await waitForViewportStable(board)
    await expect(groupArea.getByTestId('atlas-group-header')).toContainText('3 items')

    // --- Drag filing IN: a loner card dragged onto the frame highlights
    // it live (goal 0161 slice 1: the highlight now reaches the frame
    // through AtlasDragHighlightContext, not a board-wide node rebuild)
    // and files into it on drop (header count 3 -> 4). ---
    await armAndPlaceTopicCard(page, board, popover, 0.90, 0.05, 'ZzC2eLoner')
    const groupBox2 = await groupArea.boundingBox()
    if (!groupBox2) throw new Error('missing bounding box before drag-in')
    await dragBetweenAssertingMidway(
      page,
      await hittablePointOn(page, noteCard(page, 'ZzC2eLoner')),
      { x: groupBox2.x + groupBox2.width / 2, y: groupBox2.y + groupBox2.height / 2 },
      async () => {
        await expect(groupArea).toHaveAttribute('data-drag-highlight', 'true')
      },
    )
    // Same nested-preview caveat as the marker-box members above --
    // the header count is the real proof of filing.
    await expect(groupArea.getByTestId('atlas-group-header')).toContainText('4 items')
    await expect(groupArea).toHaveAttribute('data-drag-highlight', 'false')

    // --- Drag OUT from the preview (goal 0141): WITHOUT drilling in,
    // grab the child's preview tile inside the frame and drop it on
    // open canvas -- it leaves the frame (4 -> 3) and lands at the
    // dropped spot on this level. ---
    const previewLoner = noteCard(page, 'ZzC2eLoner')
    await expect(previewLoner).toBeVisible()
    await dragBetween(
      page,
      await hittablePointOn(page, previewLoner),
      // Left-middle open canvas: the bottom-right previously used here
      // now sits under the seeded Board gallery frame, whose footprint
      // grew when frame previews learned to draw filed objects (goal
      // 0266) -- and under the minimap beneath it.
      await boardPoint(board, 0.12, 0.60),
    )
    await expect(groupArea.getByTestId('atlas-group-header')).toContainText('3 items')
    await expect(noteCard(page, 'ZzC2eLoner')).toBeVisible()

    // Re-file it for the drilled drag-out below (3 -> 4), keeping the
    // rest of this flow's counts untouched.
    const groupBox3 = await groupArea.boundingBox()
    if (!groupBox3) throw new Error('missing bounding box before re-file')
    await dragBetween(
      page,
      await hittablePointOn(page, noteCard(page, 'ZzC2eLoner')),
      { x: groupBox3.x + groupBox3.width / 2, y: groupBox3.y + groupBox3.height / 2 },
    )
    await expect(groupArea.getByTestId('atlas-group-header')).toContainText('4 items')

    // --- Drag filing OUT: drilled inside the frame, drag the same
    // card past the board's own visible edge -- un-files it back to
    // the level above (header count 4 -> 3 once we return). Dropped
    // LEFT of the board (into the app's own sidebar column) rather
    // than above it (into the toolbar row) -- crossing the toolbar
    // mid-drag was observed to pan the canvas by some other means,
    // leaving nothing reliably clickable/measurable afterward. ---
    await groupArea.getByTestId('atlas-group-header').click()
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('ZzC2eGroupArea')
    await waitForViewportStable(board)
    const boardBoxNow = await board.boundingBox()
    if (!boardBoxNow) throw new Error('missing board bounding box before drag-out')
    await dragBetween(
      page,
      await hittablePointOn(page, noteCard(page, 'ZzC2eLoner')),
      { x: Math.max(boardBoxNow.x - 40, 5), y: boardBoxNow.y + boardBoxNow.height / 2 },
    )
    await expect(noteCard(page, 'ZzC2eLoner')).toHaveCount(0)
    await page.keyboard.press('Meta+ArrowUp')
    await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('ZzC2eGroupArea')
    await waitForViewportStable(board)
    await expect(noteCard(page, 'ZzC2eLoner')).toBeVisible()
    await expect(groupArea.getByTestId('atlas-group-header')).toContainText('3 items')

    // --- Dissolve: the frame's own header menu -> confirm names the
    // promotion -> the frame is gone, its 3 children are back at the
    // top level. ---
    await groupArea.getByTestId('atlas-group-header').click({ button: 'right' })
    await expect(menu).toBeVisible()
    await menu.getByText('Dissolve area', { exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Dissolve ZzC2eGroupArea?' })).toBeVisible()
    await expect(page.getByText('Its 3 items move up a level.')).toBeVisible()
    await page.getByRole('button', { name: 'Dissolve' }).click()
    await expect(groupCard(page, 'ZzC2eGroupArea')).toHaveCount(0)
    await expect(noteCard(page, 'ZzC2eMemberA')).toBeVisible()
    await expect(noteCard(page, 'ZzC2eMemberB')).toBeVisible()
    await expect(noteCard(page, 'ZzC2eInterior')).toBeVisible()

    // --- Kind picker legibility: every option shows its own
    // one-line description, not just a bare name. A fresh fractional
    // board point (not the shared clickCorner helper) -- several zoom
    // changes have accumulated by now, so a FRACTION of the board's
    // current bounds stays reliably empty regardless of the exact
    // zoom level, the way a fixed named corner no longer does. y=0.3
    // (not a bottom corner): the board's own minimap/Controls/creation
    // tray chrome (goal 0106 slice B) all live in the bottom band, so
    // the vertical middle is the one fraction guaranteed clear of all
    // three regardless of which corner a bottom-anchored point picks. ---
    // (goal 0144 removed the card-create popover; the kind-picker
    // portal regression this block checked lives in
    // atlas-page-edit.spec.ts's New-space dialog check now. The
    // instant-create path itself lands a card with an inline title --
    // proven by the flows above.)
    await page.keyboard.press('c')
    const kindCheckBox = await board.boundingBox()
    if (!kindCheckBox) throw new Error('board has no bounding box')
    await board.click({ position: { x: kindCheckBox.width * 0.95, y: kindCheckBox.height * 0.3 } })
    const kindCheckInline = page.getByTestId('atlas-inline-title')
    await expect(kindCheckInline).toBeVisible()
    await kindCheckInline.press('Escape')
    // Escape keeps the Untitled card -- delete it so counts stay true.
    await noteCard(page, 'Untitled').click({ button: 'right' })
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
    await expect(noteCard(page, 'Untitled')).toHaveCount(0)

    // --- Rider (a): a zoomed-into space with zero cards and zero
    // notes still renders the tray + supports right-click create.
    // Drag filing only targets EXISTING frames (a card with at least
    // one child already), so a childless card can't become one via a
    // plain drag -- marker-box "ZzC2eMemberA" alone instead (a marquee
    // drawn tightly around its own MEASURED bounding box, not a
    // guessed board fraction) to create a fresh one-child frame in the
    // same gesture, exercising the singular "1 card moves into this
    // area" copy along the way. Drill in, delete that one child -- the
    // drilled-in board is left with zero cards and zero notes. ---
    const memberACard = noteCard(page, 'ZzC2eMemberA')
    const memberABox = await memberACard.boundingBox()
    if (!memberABox) throw new Error('ZzC2eMemberA has no bounding box')
    await page.keyboard.press('a')
    // Both corners sit just OUTSIDE the card's own box (the marquee is
    // drawn around it, not on it) -- anchored on `board`, not
    // memberACard: `locator.hover({position})` requires the RESOLVED
    // point to actually be the given locator or its own descendant, so
    // a position outside memberACard's own box structurally can never
    // pass on that locator (elementFromPoint there resolves to the
    // sibling `.react-flow__pane`, not the card) -- this failed
    // DETERMINISTICALLY (100% reproduction via a captured trace, not a
    // flake) until re-anchored on `board`, which genuinely does contain
    // this point (goal 0184 migration fix, PR #426 CI failure). The END
    // stays an unchecked raw point: the active marquee visually alters
    // memberACard itself (a live drag-over highlight) as it's drawn
    // around it, which never satisfies a stability check on that same
    // locator's own box -- the same "the drag's own visual feedback
    // defeats a stability check on its target" class fixtures/canvas.ts's
    // dragBetweenHandles doc comment already names for connection-drag
    // targets.
    const boardBoxForRider = await board.boundingBox()
    if (!boardBoxForRider) throw new Error('board has no bounding box')
    await dragBetween(
      page,
      { locator: board, position: { x: memberABox.x - boardBoxForRider.x - 20, y: memberABox.y - boardBoxForRider.y - 20 } },
      { x: memberABox.x + memberABox.width + 20, y: memberABox.y + memberABox.height + 20 },
    )
    await expect(popover).toBeVisible()
    await expect(popover.getByTestId('atlas-placement-context')).toHaveText('1 item moves into this area')
    await selectKind(popover, ATLAS_KIND_TOPIC)
    await popover.getByTestId('atlas-placement-title').fill('ZzC2eEmptyHost')
    await popover.getByTestId('atlas-placement-submit').click()
    await expect(popover).not.toBeVisible()
    const emptyHostFrame = groupCard(page, 'ZzC2eEmptyHost')
    await expect(emptyHostFrame.getByTestId('atlas-group-header')).toContainText('1 item')
    await emptyHostFrame.getByTestId('atlas-group-header').click()
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('ZzC2eEmptyHost')
    await deleteCardViaMenu(page, menu, 'ZzC2eMemberA')
    await expect(page.getByTestId('atlas-empty-space')).toBeVisible()
    await expect(page.getByTestId('atlas-creation-tray')).toBeVisible()

    // --- Within-file cleanup (ZzC2eMemberA already deleted above).
    // ZzC2eEmptyHost is childless again now (its own delete-child
    // step just left it that way) -- it reverted to a plain leaf card
    // per the same "no frame until it has children" render rule
    // proven above, so its own cleanup is the ordinary card delete
    // too, not the frame-menu path. ---
    await page.keyboard.press('Meta+ArrowUp')
    for (const title of ['ZzC2eEmptyArea', 'ZzC2eEmptyHost', 'ZzC2eMemberB', 'ZzC2eInterior', 'ZzC2eLoner']) {
      await deleteCardViaMenu(page, menu, title)
    }
  } finally {
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

