import { chromium, expect, test } from '@playwright/test'
import { blurSticky, fillSticky } from './fixtures/codeEditor'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ATLAS_SELECT_GROUP_MCP_BASE_PORT,
  ATLAS_SELECT_GROUP_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { contextMenu } from './fixtures/contextMenu'
import { ATLAS_KIND_TOPIC, selectKind } from './fixtures/kindPicker'
import { armAndPlaceTopicCard, clickBoardPoint, deleteCardViaMenu, groupCard, noteCard } from './fixtures/atlasBoard'
import { waitForViewportStable } from './fixtures/animation'

// Select-then-group in its OWN file deliberately: the flow is
// deterministic on a fresh single-purpose worker but interfered with
// when sharing a worker with the containment spec's heavy gesture
// tests (observed repeatedly; port separation alone did not cure it).
// File-level isolation is the repo's own per-worker-server boundary.

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

// Gesture-dense flow (a retried box-select loop + two placements +
// the full group flow): comfortably inside the default budget alone,
// but under parallel-worker machine load the retry loops legitimately
// stack past 60s -- the budget, not any step, was what failed.
test.setTimeout(180_000)

// fixme, not skip-on-CI: the box-select synthesis fails locally too under
// any load (coin-flip solo) -- the flow is probe-proven live and the manual
// check lives in testing.md's registry; revisit per QUARANTINE.md's entry.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test.fixme('atlas multi-select: the selection-overlay context menu reaches Group into new area (goal 0081 follow-up)', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-atlas-select-group-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = ATLAS_SELECT_GROUP_SERVER_BASE_PORT + idx
  const mcpPort = ATLAS_SELECT_GROUP_MCP_BASE_PORT + idx

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

    await armAndPlaceTopicCard(page, board, popover, 0.25, 0.05, 'ZzC2eSelectA')
    await armAndPlaceTopicCard(page, board, popover, 0.55, 0.05, 'ZzC2eSelectB')

    // The shift-drag box select is the app's ONLY multi-select door
    // (plain click glances, meta-click opens -- the locked gesture
    // map), and its synthesis is CI-invisible: React Flow samples
    // deltas between real pointermove events, and synthesized moves
    // coalesce under load into a rectangle it never registers (the
    // documented pointer-coalescing class). Pointer already AT the
    // start point before Shift goes down, dense steps, boxes
    // re-measured per attempt.
    const cardA = noteCard(page, 'ZzC2eSelectA')
    const cardB = noteCard(page, 'ZzC2eSelectB')
    await expect(async () => {
      const boxA = await cardA.boundingBox()
      const boxB = await cardB.boundingBox()
      if (!boxA || !boxB) throw new Error('missing bounding box before shift-drag select')
      const dragFrom = { x: boxA.x - 15, y: boxA.y - 15 }
      const dragTo = { x: boxB.x + boxB.width + 15, y: boxB.y + boxB.height + 15 }
      // Checked start (goal 0184): the corner sits just outside cardA's
      // own box (the marquee is drawn around it) -- still a valid point
      // to check cardA's own actionability against.
      await cardA.hover({ position: { x: -15, y: -15 } })
      await page.keyboard.down('Shift')
      // Shift must already be held before mousedown (React Flow reads
      // the modifier at drag-start) -- the shared checked-drag helper
      // checks-then-presses with no room for an interleaved key hold,
      // so raw page.mouse stays here, scoped to this one gesture.
      // eslint-disable-next-line no-restricted-syntax -- interleaved Shift hold, see comment above
      await page.mouse.down()
      await page.waitForTimeout(100) // no DOM condition marks RF's drag-arm; see header comment
      const steps = 15
      for (let i = 1; i <= steps; i++) {
        // eslint-disable-next-line no-restricted-syntax -- free-form drag path, inherently unchecked (goal 0184 RESEARCH VERDICT)
        await page.mouse.move(dragFrom.x + ((dragTo.x - dragFrom.x) * i) / steps, dragFrom.y + ((dragTo.y - dragFrom.y) * i) / steps)
      }
      await page.waitForTimeout(100) // same: RF samples trailing moves before selection commits
      // eslint-disable-next-line no-restricted-syntax -- interleaved Shift hold, see comment above
      await page.mouse.up()
      await page.keyboard.up('Shift')
      await expect(page.locator('.react-flow__node.selected')).toHaveCount(2, { timeout: 1_500 })
    }).toPass({ timeout: 15_000, intervals: [500] })

    // Regression: with a live multi-selection React Flow draws a
    // selection-rectangle overlay COVERING the member nodes, so a
    // node-locator right-click never becomes actionable (the overlay
    // intercepts pointer events) and onNodeContextMenu never fires --
    // the group menu was unreachable through the very gesture that
    // creates the selection. The board now handles the overlay's own
    // onSelectionContextMenu; right-click by coordinates, exactly as
    // a user's pointer does, landing on the overlay.
    const boxAfterSelect = await cardA.boundingBox()
    if (!boxAfterSelect) throw new Error('missing bounding box for selected card')
    // Each attempt is the FULL gesture (right-click -> item -> popover):
    // Primer's menu overlay animates in, and an immediate item click
    // can land on the not-yet-settled overlay's outside region,
    // closing the menu (this repo's documented animation-race class) --
    // a partial retry can't reopen a closed menu, so retry the whole
    // gesture.
    await expect(async () => {
      if (await popover.isVisible()) return
      // Deliberately not a locator click: the target IS the overlay
      // that's on top at this point (the comment above), not cardA
      // itself -- a cardA-anchored click would report the overlay as
      // "intercepting" what's actually the intended recipient.
      // eslint-disable-next-line no-restricted-syntax -- raw coordinate click lands on whatever overlay is on top, by design (see comment above)
      await page.mouse.click(boxAfterSelect.x + boxAfterSelect.width / 2, boxAfterSelect.y + boxAfterSelect.height / 2, { button: 'right' })
      await expect(menu).toBeVisible({ timeout: 2_000 })
      await menu.getByText('Group into new area', { exact: true }).click({ timeout: 2_000 })
      await expect(popover).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 25_000, intervals: [500] })
    await expect(page.getByTestId('atlas-placement-context')).toContainText('2 items')
    await selectKind(popover, ATLAS_KIND_TOPIC)
    await popover.getByTestId('atlas-placement-title').fill('ZzC2eGroupedArea')
    await popover.getByTestId('atlas-placement-submit').click()
    await expect(popover).not.toBeVisible()
    const groupedArea = groupCard(page, 'ZzC2eGroupedArea')
    await expect(groupedArea).toBeVisible()
    await expect(groupedArea.getByTestId('atlas-group-header')).toContainText('2 items')

    // Cleanup (testing.md's within-file discipline): dissolving the
    // area promotes both cards back to top level, then delete them.
    await groupedArea.getByTestId('atlas-group-header').click({ button: 'right' })
    await expect(menu).toBeVisible()
    await menu.getByText('Dissolve area', { exact: true }).click()
    await expect(page.getByRole('button', { name: 'Dissolve' })).toBeVisible()
    await page.getByRole('button', { name: 'Dissolve' }).click()
    await expect(groupedArea).toHaveCount(0)
    // The multi-selection SURVIVES the group+dissolve round-trip (the
    // selection-preservation this PR adds), so a member right-click
    // would reopen the MULTI menu and the cleanup's single-card
    // deletes would collide with it -- clear it the way a user does,
    // one click on empty pane (React Flow's native deselect path).
    await clickBoardPoint(page, { x: 10, y: 300 })
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(0)
    await deleteCardViaMenu(page, menu, 'ZzC2eSelectA')
    await deleteCardViaMenu(page, menu, 'ZzC2eSelectB')
  } finally {
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

// Shift-CLICK select (goal 0092): the click-based door to the same
// multi-select the box-drag opens -- and, unlike box-drag pointer
// synthesis (the quarantined test above), a plain modifier click is
// fully CI-synthesizable, so this test carries the automated coverage
// for the select -> group / select -> delete chains.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('atlas shift-click select: toggle membership, group via member right-click, quick delete + undo over the selection (goals 0092, 0093)', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-atlas-click-select-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = ATLAS_SELECT_GROUP_SERVER_BASE_PORT + idx
  const mcpPort = ATLAS_SELECT_GROUP_MCP_BASE_PORT + idx

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

    await armAndPlaceTopicCard(page, board, popover, 0.25, 0.05, 'ZzK2eClickA')
    await armAndPlaceTopicCard(page, board, popover, 0.55, 0.05, 'ZzK2eClickB')

    const cardA = noteCard(page, 'ZzK2eClickA')
    const cardB = noteCard(page, 'ZzK2eClickB')
    const selected = page.locator('.react-flow__node.selected')

    // Toggle in, toggle out, toggle back in -- and no commit on any of
    // it (the shift guard on the card's own click handler).
    await cardA.click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(1)
    await cardB.click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(2)

    // Regression: a selected STICKY's ring must survive its yellow
    // ground -- the border flips to the accent on selection (the 2px
    // card ring alone was invisible over the attention tint).
    await page.keyboard.press('n')
    const noteBB = await board.boundingBox()
    if (!noteBB) throw new Error('board box missing for note placement')
    // Bottom-LEFT, not bottom-right: the board's own minimap (goal
    // 0106 slice B) now occupies the bottom-right corner, offset off
    // the true left edge to clear React Flow's own Controls strip there.
    await board.click({ position: { x: 80, y: noteBB.height - 80 } })
    await fillSticky(page, 'ZzK2eStickySel')
    await blurSticky(page)
    const stickyNote = page.locator('[data-testid="atlas-sticky-note"]')
    const restingBorder = await stickyNote.evaluate((el) => getComputedStyle(el).borderColor)
    await stickyNote.click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(3)
    const selectedBorder = await stickyNote.evaluate((el) => getComputedStyle(el).borderColor)
    expect(selectedBorder).not.toBe(restingBorder)
    // Deselect + delete the note so the rest of the flow sees its
    // original two-card selection world.
    await stickyNote.click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(2)
    await stickyNote.click({ button: 'right' })
    await menu.getByText('Delete note', { exact: true }).click()
    await expect(stickyNote).toHaveCount(0)
    await cardB.click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(1)
    await cardB.click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(2)

    // Visible selection state (goal 0092 follow-up): both member nodes
    // carry a real, non-empty outline/ring, not just React Flow's own
    // unstyled .selected class. Measured on the wrapper (the ring's
    // own carrier), not the inner card -- Primer's [role="button"]
    // focus reset can zero a box-shadow scoped to the inner element.
    const cardAWrapper = selected.filter({ has: cardA })
    const cardBWrapper = selected.filter({ has: cardB })
    await expect.poll(() => cardAWrapper.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')
    await expect.poll(() => cardBWrapper.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')

    // The selection tray replaces the creation tray while 2+ cards are
    // selected: count label, Group (2+ cards only), Delete, both with
    // their kbd chips.
    const selectionTray = page.getByTestId('atlas-selection-tray')
    await expect(selectionTray).toBeVisible()
    await expect(page.getByTestId('atlas-creation-tray')).toHaveCount(0)
    await expect(page.getByTestId('atlas-selection-count')).toHaveText('2 selected')
    const trayGroup = page.getByTestId('atlas-selection-group')
    await expect(trayGroup).toContainText('Group')
    await expect(trayGroup).toContainText('G')
    const trayDelete = page.getByTestId('atlas-selection-delete')
    await expect(trayDelete).toContainText('Delete')
    await expect(trayDelete).toContainText('⌫')

    // Escape clears the selection (the ladder's own first rung with a
    // live selection, goal 0102) -- the creation tray comes back.
    await page.keyboard.press('Escape')
    await expect(selected).toHaveCount(0)
    await expect(selectionTray).toHaveCount(0)
    await expect(page.getByTestId('atlas-creation-tray')).toBeVisible()

    // Re-select, then bare G opens the SAME group popover a member
    // right-click's own menu item does -- anchored at the selection
    // tray's own on-screen rect (bottom-center; the same anchor the
    // tray's Group button uses), nowhere near where the members
    // actually render. Completed here (not just opened) so the new
    // area's Position can be checked against this anchor specifically.
    await cardA.click({ modifiers: ['Shift'] })
    await cardB.click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(2)
    const boxAPreBareG = await cardA.boundingBox()
    const boxBPreBareG = await cardB.boundingBox()
    if (!boxAPreBareG || !boxBPreBareG) throw new Error('missing bounding box before group')
    const preBareGTop = Math.min(boxAPreBareG.y, boxBPreBareG.y)
    const preBareGLeft = Math.min(boxAPreBareG.x, boxBPreBareG.x)
    await page.keyboard.press('g')
    await expect(popover).toBeVisible()
    await expect(page.getByTestId('atlas-placement-context')).toContainText('2 items')
    await selectKind(popover, ATLAS_KIND_TOPIC)
    await popover.getByTestId('atlas-placement-title').fill('ZzK2eBareGArea')
    await popover.getByTestId('atlas-placement-submit').click()
    await expect(popover).not.toBeVisible()
    const bareGArea = groupCard(page, 'ZzK2eBareGArea')
    await expect(bareGArea).toBeVisible()

    // Regression: the new area's own Position previously came from the
    // triggering anchor point (the selection tray's own rect for bare
    // G / its Group button), not the grouped members' own rendered
    // spot -- the tray floats bottom-center, so this door landed the
    // new area far below the members regardless of where they visibly
    // were. The camera never moves for a group action, so screen-space
    // bounding boxes before and after are directly comparable.
    const bareGAreaBox = await bareGArea.boundingBox()
    if (!bareGAreaBox) throw new Error('missing bounding box for grouped area')
    const boardBoxAfterBareG = await board.boundingBox()
    if (!boardBoxAfterBareG) throw new Error('missing bounding box for board')
    expect(Math.abs(bareGAreaBox.y - preBareGTop)).toBeLessThan(250)
    expect(Math.abs(bareGAreaBox.x - preBareGLeft)).toBeLessThan(250)
    expect(bareGAreaBox.y).toBeLessThan(boardBoxAfterBareG.y + boardBoxAfterBareG.height - 250)

    // Dissolve back to loose cards, deselect (group+dissolve preserves
    // the multi-selection), then re-select for the context-menu door
    // exercised next.
    await bareGArea.getByTestId('atlas-group-header').click({ button: 'right' })
    await expect(menu).toBeVisible()
    await menu.getByText('Dissolve area', { exact: true }).click()
    await expect(page.getByRole('button', { name: 'Dissolve' })).toBeVisible()
    await page.getByRole('button', { name: 'Dissolve' }).click()
    await expect(bareGArea).toHaveCount(0)
    // Escape clears the selection (proven earlier in this same test) --
    // a fixed board-content-independent deselect, unlike an absolute
    // pane coordinate, which a seeded card landing under that exact
    // pixel can turn into a re-select instead of a deselect.
    await page.keyboard.press('Escape')
    await expect(selected).toHaveCount(0)
    await cardA.click({ modifiers: ['Shift'] })
    await cardB.click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(2)

    // Regression fixture: the new area's own Position must land at the
    // members' CURRENT rendered spot, not the triggering right-click
    // point -- captured before the group gesture so it survives the
    // popover interaction.
    const boxAPreGroup = await cardA.boundingBox()
    const boxBPreGroup = await cardB.boundingBox()
    if (!boxAPreGroup || !boxBPreGroup) throw new Error('missing bounding box before group')
    const preGroupTop = Math.min(boxAPreGroup.y, boxBPreGroup.y)
    const preGroupLeft = Math.min(boxAPreGroup.x, boxBPreGroup.x)

    // Member right-click reaches the multi menu -> Group into new area
    // (same full-gesture retry as above: Primer's menu overlay animates
    // in, and a too-early item click lands outside and closes it).
    await expect(async () => {
      if (await popover.isVisible()) return
      await cardA.click({ button: 'right' })
      await expect(menu).toBeVisible({ timeout: 2_000 })
      await menu.getByText('Group into new area', { exact: true }).click({ timeout: 2_000 })
      await expect(popover).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 25_000, intervals: [500] })
    await expect(page.getByTestId('atlas-placement-context')).toContainText('2 items')
    await selectKind(popover, ATLAS_KIND_TOPIC)
    await popover.getByTestId('atlas-placement-title').fill('ZzK2eClickArea')
    await popover.getByTestId('atlas-placement-submit').click()
    await expect(popover).not.toBeVisible()
    const groupedArea = groupCard(page, 'ZzK2eClickArea')
    await expect(groupedArea).toBeVisible()
    await expect(groupedArea.getByTestId('atlas-group-header')).toContainText('2 items')

    // Regression: the new area's Position previously came from the
    // triggering right-click/button point, not the grouped members' own
    // spot -- landing far from where the members visibly were. The
    // camera never moves for a group action, so screen-space bounding
    // boxes before and after are directly comparable.
    const groupedAreaBox = await groupedArea.boundingBox()
    if (!groupedAreaBox) throw new Error('missing bounding box for grouped area')
    const boardBoxAfterGroup = await board.boundingBox()
    if (!boardBoxAfterGroup) throw new Error('missing bounding box for board')
    expect(Math.abs(groupedAreaBox.y - preGroupTop)).toBeLessThan(250)
    expect(Math.abs(groupedAreaBox.x - preGroupLeft)).toBeLessThan(250)
    expect(groupedAreaBox.y).toBeLessThan(boardBoxAfterGroup.y + boardBoxAfterGroup.height - 250)

    // Dissolve back to loose cards, then Delete over a re-made
    // shift-click selection: the confirm names the count, and
    // confirming deletes both -- which is also this test's cleanup
    // (testing.md's within-file discipline).
    await groupedArea.getByTestId('atlas-group-header').click({ button: 'right' })
    await expect(menu).toBeVisible()
    await menu.getByText('Dissolve area', { exact: true }).click()
    await expect(page.getByRole('button', { name: 'Dissolve' })).toBeVisible()
    await page.getByRole('button', { name: 'Dissolve' }).click()
    await expect(groupedArea).toHaveCount(0)
    // Escape clears the selection -- same fixed, content-position-
    // independent deselect as this file's earlier bare-G dissolve.
    await page.keyboard.press('Escape')
    await expect(selected).toHaveCount(0)

    // Quick delete + undo (goal 0093): Del deletes instantly, no
    // confirm dialog -- the toast names the count, and clicking Undo
    // restores both cards.
    await cardA.click({ modifiers: ['Shift'] })
    await cardB.click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(2)
    await page.keyboard.press('Delete')
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(cardA).toHaveCount(0)
    await expect(cardB).toHaveCount(0)
    const undoToast = page.getByTestId('atlas-undo-toast')
    await expect(undoToast).toBeVisible()
    await expect(undoToast).toContainText('Deleted 2')
    await undoToast.getByTestId('atlas-undo-toast-button').click()
    await expect(undoToast).toHaveCount(0)
    await expect(cardA).toBeVisible()
    await expect(cardB).toBeVisible()

    // Second pass: Del, then ⌘Z restores while the toast still lives.
    await cardA.click({ modifiers: ['Shift'] })
    await cardB.click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(2)
    await page.keyboard.press('Delete')
    await expect(cardA).toHaveCount(0)
    await expect(undoToast).toBeVisible()
    await page.keyboard.press('Meta+z')
    await expect(undoToast).toHaveCount(0)
    await expect(cardA).toBeVisible()
    await expect(cardB).toBeVisible()

    // Toast expiry commits the delete -- clock-controlled, no real 10s
    // wait (testing.md's waitForTimeout rule). This is also the test's
    // own cleanup: once the toast auto-hides the delete stands and
    // both cards stay gone.
    await page.clock.install()
    await cardA.click({ modifiers: ['Shift'] })
    await cardB.click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(2)
    await page.keyboard.press('Delete')
    await expect(undoToast).toBeVisible()
    await page.clock.fastForward('00:11')
    await expect(undoToast).toHaveCount(0)
    await expect(cardA).toHaveCount(0)
    await expect(cardB).toHaveCount(0)
  } finally {
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})



// atlas select-all (⌘A) moved to atlas-select-all.spec.ts at the 500-line
// convention (CLAUDE.md) -- fully self-contained, no shared state with
// the flows above.
