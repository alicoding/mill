import { test, expect } from './fixtures/server'
import { boardPoint, dragBetween, nonSeededBoardObjects } from './fixtures/atlasBoard'
import { clickAtlasTrayTool } from './fixtures/atlasTray'
import { contextMenu } from './fixtures/contextMenu'
import { waitForViewportStable } from './fixtures/animation'

// The Drawing plugin's storage door (goal 0277): the pencil's last-
// used style persists across an app restart through api.storage.
// Own spec file (atlas-pencil-tool.spec.ts is at the file-size
// convention); shared pool -- the one global it writes (the plugin's
// stored style) is restored to the shipped default before it ends.

// The last-used pencil style survives a RELOAD (goal 0277, the
// Drawing plugin's own storage door): the colour picked before a
// stroke is the picker's selected swatch after the app restarts. The
// default is restored the same way (pick it, stroke) before the test
// ends, since other tests in this file assume the first swatch.
test('the pencil\'s last-used colour survives a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  const ink = nonSeededBoardObjects(page, 'ink')

  const pickAndStroke = async (swatch: string, from: [number, number], to: [number, number]) => {
    await clickAtlasTrayTool(page, 'atlas-tray-pencil')
    const picker = page.getByTestId('atlas-pencil-style-picker')
    await expect(picker).toBeVisible()
    await picker.getByTestId(`atlas-pencil-color-${swatch}`).click()
    await expect(picker.getByTestId(`atlas-pencil-color-${swatch}`)).toHaveAttribute('data-selected', 'true')
    const before = await ink.count()
    await dragBetween(page, await boardPoint(board, from[0], from[1]), await boardPoint(board, to[0], to[1]))
    await expect(ink).toHaveCount(before + 1)
    await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  }

  await pickAndStroke('da3633', [0.05, 0.1], [0.15, 0.2])
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(board).toBeVisible()
  // The reload re-fits the viewport around the stroke; the picker
  // check needs no settling, the cleanup clicks below do.
  await waitForViewportStable(board)
  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  const picker = page.getByTestId('atlas-pencil-style-picker')
  await expect(picker).toBeVisible()
  await expect(picker.getByTestId('atlas-pencil-color-da3633')).toHaveAttribute('data-selected', 'true')
  await clickAtlasTrayTool(page, 'atlas-tray-pencil')

  // Restore the shipped default for the rest of the file, then clean up.
  await pickAndStroke('1f6feb', [0.3, 0.1], [0.4, 0.2])
  // Each delete re-syncs the board; wait for the count to drop before
  // taking the next handle, or the next right-click lands on a node
  // mid-remount.
  for (let remaining = await ink.count(); remaining > 0; remaining--) {
    await ink.first().click({ button: 'right', force: true })
    const menu = contextMenu(page)
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
    await expect(ink).toHaveCount(remaining - 1)
  }
})
