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

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('atlas containment: shift-drag box select marks 2 cards selected (goal 0081 slice A5 rider (b))', async ({}, testInfo) => {
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

    // React Flow's own box-select gesture (independent of the Area
    // tool's marquee, per this file's own onSelectionChange comment
    // above): holding Shift while dragging on empty canvas selects
    // every node the box touches, rather than panning. The pointer
    // must already be AT the start point before Shift goes down and
    // the button presses -- pressing Shift first (then moving into
    // position) was observed to make React Flow compute a selection
    // rectangle anchored somewhere other than the actual mousedown
    // point, silently selecting nothing. Wrapped in the same
    // expect(...).toPass() retry idiom fixtures/canvasNode.ts's
    // clickCanvasNode already established for React Flow interaction
    // races -- boxes are re-measured on every attempt, not read once
    // and reused, in case an early attempt's own settle time shifted
    // them.
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
      await page.waitForTimeout(100)
      const steps = 15
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(dragFrom.x + ((dragTo.x - dragFrom.x) * i) / steps, dragFrom.y + ((dragTo.y - dragFrom.y) * i) / steps)
      }
      await page.waitForTimeout(100)
      await page.mouse.up()
      await page.keyboard.up('Shift')
      await expect(page.locator('.react-flow__node.selected')).toHaveCount(2, { timeout: 1_000 })
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
    await deleteCardViaMenu(page, menu, 'ZzC2eSelectA')
    await deleteCardViaMenu(page, menu, 'ZzC2eSelectB')
  } finally {
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
