import { expect as baseExpect, test as pluginTest } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect } from './fixtures/server'
import { dragBetween } from './fixtures/atlasBoard'
import { clickAtlasTrayTool } from './fixtures/atlasTray'
import { deleteViaContextMenu, shapeDrawPoints, shapeObjects } from './fixtures/atlasShapeTool'
import { contextMenu } from './fixtures/contextMenu'
import { launchWithPlugins, runFromPalette } from './fixtures/runtimePlugins'
import { applyCpuThrottle } from './fixtures/throttle'

// The two declared-menu seats (goal 0349 S2b): editor/context in a
// plugin canvas object's own right-click menu, view/title in a plugin
// view's tab header. mill-drawing (built-in, always active) proves the
// first on the SHARED worker pool, the same way atlas-shape-tool.spec.ts
// already exercises its shape tool. mill-request-tester proves the
// second on a DEDICATED server (offset 82: 62 and 102 both unclaimed,
// runtimePlugins.ts's own picking rule) -- reaching its view needs the
// plugin present in the folder the shared pool's own plugins dir must
// stay intact from, the same reasoning settings-extensions-remove.spec.ts
// already documents for install/remove.

test('right-clicking a mill-drawing object shows its declared editor/context item after a divider, and running it fires the notice', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await clickAtlasTrayTool(page, 'atlas-tray-shape')
  const picker = page.getByTestId('atlas-shape-style-picker')
  const draw = await shapeDrawPoints(page, board, picker)
  await dragBetween(page, draw.from, draw.to)
  const shapes = shapeObjects(page)
  await expect(shapes).toHaveCount(1)

  await shapes.first().click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await expect(menu.locator('[data-component="ActionList.Divider"]')).toHaveCount(1)
  const tipsItem = menu.getByText('Drawing tips', { exact: true })
  await expect(tipsItem).toBeVisible()
  await tipsItem.click()

  await expect(page.getByTestId('notice-text')).toContainText('Hold Shift while dragging the shape tool')

  await shapes.first().click({ button: 'right' })
  await deleteViaContextMenu(page, shapes.first())
  await expect(shapes).toHaveCount(0)
})

// goal 0349 S2c: the title action's honest enablement is a declared
// when clause (contributes.menus["view/title"][0].when ==
// "plugin.hasResult"), so it is ABSENT until tester.js's own send
// handler contributes that context key -- not merely disabled, since
// this plugin activates in its own sandboxed frame and had no other
// way to answer Command.enabled truthfully before S2c.
pluginTest('the Request tester\'s "Send again" title action is absent before the first send, present after, and re-sends the current request', async () => {
  const http = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"pong":true}') })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const port = (http.address() as AddressInfo).port
  const { page, close } = await launchWithPlugins(82)
  try {
    await page.goto('/')
    await page.getByRole('link', { name: 'Atlas' }).click()
    await baseExpect(page.getByTestId('atlas-board')).toBeVisible()
    await runFromPalette(page, 'Request tester')

    const actions = page.getByTestId('work-tab-title-actions-mill-request-tester-tester')
    await baseExpect(actions).toHaveCount(0)

    const frame = page.frameLocator('[data-testid="plugin-view-mill-request-tester-tester"]')
    await frame.getByTestId('tester-url').fill(`http://127.0.0.1:${port}/ping`)
    await frame.getByTestId('tester-send').click()
    await baseExpect(frame.getByTestId('tester-status')).toContainText('needs your approval')
    await baseExpect(actions).toHaveCount(0)

    const reviewPage = await page.context().newPage()
    await applyCpuThrottle(reviewPage)
    await reviewPage.goto('/')
    await reviewPage.getByRole('link', { name: 'Review' }).click()
    const parked = reviewPage.locator('[data-testid="review-guarded-action-item"]')
    await baseExpect(parked).toHaveCount(1)
    await parked.locator('[data-testid="review-guarded-action-approve"]').click()
    await baseExpect(parked).toHaveCount(0)
    await reviewPage.close()

    await baseExpect(frame.getByTestId('tester-status')).toContainText('200')
    await baseExpect(actions).toBeVisible()
    const sendAgain = actions.getByRole('button', { name: 'Send again' })
    await baseExpect(sendAgain).toBeVisible()

    // The observable effect (goal 0349 S2b amendment): clicking the
    // title action posts into the frame, which re-clicks Send with the
    // same fields -- a second parked approval is proof the frame
    // received the message and acted on it, not just that the button
    // exists.
    const reviewPage2 = await page.context().newPage()
    await applyCpuThrottle(reviewPage2)
    await reviewPage2.goto('/')
    await reviewPage2.getByRole('link', { name: 'Review' }).click()
    const parked2 = reviewPage2.locator('[data-testid="review-guarded-action-item"]')
    await sendAgain.click()
    await baseExpect(parked2).toHaveCount(1)
    await reviewPage2.close()
  } finally {
    await close()
    await new Promise<void>((resolve) => http.close(() => resolve()))
  }
})
