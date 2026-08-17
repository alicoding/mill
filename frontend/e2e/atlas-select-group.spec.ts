import { chromium, expect, test } from '@playwright/test'
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
import { armAndPlaceTopicCard, deleteCardViaMenu, groupCard, noteCard } from './fixtures/atlasBoard'
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
      await page.mouse.move(dragFrom.x, dragFrom.y)
      await page.keyboard.down('Shift')
      await page.mouse.down()
      await page.waitForTimeout(100) // no DOM condition marks RF's drag-arm; see header comment
      const steps = 15
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(dragFrom.x + ((dragTo.x - dragFrom.x) * i) / steps, dragFrom.y + ((dragTo.y - dragFrom.y) * i) / steps)
      }
      await page.waitForTimeout(100) // same: RF samples trailing moves before selection commits
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
      await page.mouse.click(boxAfterSelect.x + boxAfterSelect.width / 2, boxAfterSelect.y + boxAfterSelect.height / 2, { button: 'right' })
      await expect(menu).toBeVisible({ timeout: 2_000 })
      await menu.getByText('Group into new area', { exact: true }).click({ timeout: 2_000 })
      await expect(popover).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 25_000, intervals: [500] })
    await expect(page.getByTestId('atlas-placement-context')).toContainText('2 cards')
    await selectKind(popover, ATLAS_KIND_TOPIC)
    await popover.getByTestId('atlas-placement-title').fill('ZzC2eGroupedArea')
    await popover.getByTestId('atlas-placement-submit').click()
    await expect(popover).not.toBeVisible()
    const groupedArea = groupCard(page, 'ZzC2eGroupedArea')
    await expect(groupedArea).toBeVisible()
    await expect(groupedArea.getByTestId('atlas-group-header')).toContainText('2 cards')

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
    await page.mouse.click(10, 300)
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
test('atlas shift-click select: toggle membership, group via member right-click, Delete over the selection (goal 0092)', async ({}, testInfo) => {
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

    // Toggle in, toggle out, toggle back in -- and no glance-flip on
    // any of it (the shift guard on the card's own click handler).
    await cardA.click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(1)
    await cardB.click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(2)
    await expect(page.locator('[data-testid="atlas-note-card"][data-flipped="true"]')).toHaveCount(0)
    await cardB.click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(1)
    await cardB.click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(2)

    // Visible selection state (goal 0092 follow-up): both member nodes
    // carry a real, non-empty outline/ring, not just React Flow's own
    // unstyled .selected class.
    await expect.poll(() => cardA.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')
    await expect.poll(() => cardB.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')

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

    // Escape clears the selection (takes precedence over the board's
    // own unflip duty) -- the creation tray comes back.
    await page.keyboard.press('Escape')
    await expect(selected).toHaveCount(0)
    await expect(selectionTray).toHaveCount(0)
    await expect(page.getByTestId('atlas-creation-tray')).toBeVisible()

    // Re-select, then bare G opens the SAME group popover a member
    // right-click's own menu item does -- closed here without
    // submitting so the flow below (member right-click -> Group) is
    // the one that actually creates the area.
    await cardA.click({ modifiers: ['Shift'] })
    await cardB.click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(2)
    await page.keyboard.press('g')
    await expect(popover).toBeVisible()
    await expect(page.getByTestId('atlas-placement-context')).toContainText('2 cards')
    await popover.getByTestId('atlas-placement-cancel').click()
    await expect(popover).not.toBeVisible()

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
    await expect(page.getByTestId('atlas-placement-context')).toContainText('2 cards')
    await selectKind(popover, ATLAS_KIND_TOPIC)
    await popover.getByTestId('atlas-placement-title').fill('ZzK2eClickArea')
    await popover.getByTestId('atlas-placement-submit').click()
    await expect(popover).not.toBeVisible()
    const groupedArea = groupCard(page, 'ZzK2eClickArea')
    await expect(groupedArea).toBeVisible()
    await expect(groupedArea.getByTestId('atlas-group-header')).toContainText('2 cards')

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
    // Deselect on the pane itself, low-right where nothing renders --
    // absolute page coords near the left edge can land on the
    // creation tray, which never reaches React Flow's pane handler.
    await page.locator('.react-flow__pane').click({ position: { x: 500, y: 450 } })
    await expect(selected).toHaveCount(0)

    await cardA.click({ modifiers: ['Shift'] })
    await cardB.click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(2)
    await page.keyboard.press('Delete')
    const confirmDialog = page.getByRole('alertdialog')
    await expect(confirmDialog).toBeVisible()
    await expect(confirmDialog).toContainText('2 cards')
    await confirmDialog.getByRole('button', { name: 'Delete' }).click()
    await expect(cardA).toHaveCount(0)
    await expect(cardB).toHaveCount(0)
  } finally {
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
