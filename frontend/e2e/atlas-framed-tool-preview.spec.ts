import { test, expect } from './fixtures/server'
import { boardPoint, nonSeededBoardObjects } from './fixtures/atlasBoard'
import { dragBetween } from './fixtures/atlasBoardPointer'
import { clickAtlasTrayTool } from './fixtures/atlasTray'

// The framed canvas API's own liveness (docs/goals/0380 Decision 1).
// The drawing tools now run inside the extension sandbox: Mill owns
// the pointer, the tool answers with draft writes over the bridge, and
// Mill paints the preview from that draft. The property no unit test
// can hold is that the round trip keeps up with the drag -- the
// painted preview must CHANGE as the pointer moves, not appear once
// and freeze -- and that the draft leaves nothing behind once the
// stroke is placed.
//
// Shared pool: the one object created here is deleted here.

test('the sandboxed pencil’s preview is repainted from its own draft as the pointer moves, and leaves nothing behind', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await clickAtlasTrayTool(page, 'atlas-tray-pencil')

  const path = page.locator('[data-testid="atlas-pencil-preview"] path')
  const drawn = new Set<string>()
  await dragBetween(
    page,
    await boardPoint(board, 0.55, 0.62),
    await boardPoint(board, 0.78, 0.82),
    undefined,
    async () => {
      // Sampled with the button still down: a preview that was painted
      // once and froze would pass "is visible" and still be the bug
      // this test exists for, so what is recorded is how many DISTINCT
      // outlines the extension's own draft produced across the drag.
      const d = await path.getAttribute('d').catch(() => null)
      if (d) drawn.add(d)
    },
  )

  expect(drawn.size).toBeGreaterThan(1)

  const ink = nonSeededBoardObjects(page, 'ink')
  await expect(ink).toHaveCount(1)
  // The draft goes with the gesture: a committed stroke is the object,
  // never an object plus a leftover preview.
  await expect(page.locator('[data-testid="atlas-pencil-preview"]')).toHaveCount(0)

  await ink.first().click()
  await page.keyboard.press('Delete')
  await expect(ink).toHaveCount(0)
})
