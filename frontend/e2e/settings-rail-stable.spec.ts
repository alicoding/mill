import { test, expect } from './fixtures/server'
import { gotoAppReady } from './fixtures/appReady'
import { openSettings, type SettingsGroup } from './fixtures/settingsNav'
import type { Locator, Page } from '@playwright/test'

// Regression: the group rail (SettingsGroupNav) sat inside PageContainer's
// "narrow" variant, a flex item with auto side margins -- shrink-to-fit
// sizing, not a definite width, so the box (and the rail pinned to its
// left edge) resized to each pane's own max-content width and
// `margin: 0 auto` re-centred it. Every pane now renders through the
// same definite-width box (goal 0336), so the rail's position must be
// identical across all eight groups. Extensions left this list in goal
// 0349 -- it is its own top-level destination now, not a Settings pane.
// count: fixture-owned -- mirrors shared/settingsGroups.ts's own
// SETTINGS_GROUPS by hand; a group added there and not here just skips
// this test's coverage rather than failing it.
const GROUPS: SettingsGroup[] = [
  'general', 'appearance', 'security', 'shortcuts',
  'connections', 'notifications', 'backups', 'updates',
]

// boundingBox() right after a click can race a render that hasn't
// committed layout yet; poll until two consecutive reads agree instead
// of a fixed sleep (.claude/rules/testing.md).
async function stableBoundingBox(locator: Locator): Promise<{ x: number; y: number }> {
  let previous: { x: number; y: number } | null = null
  await expect
    .poll(async () => {
      const box = await locator.boundingBox()
      if (!box) return false
      const stable = previous !== null && previous.x === box.x && previous.y === box.y
      previous = { x: box.x, y: box.y }
      return stable
    }, { timeout: 5_000 })
    .toBe(true)
  if (!previous) throw new Error('stableBoundingBox: expected the rail to be measurable')
  return previous
}

async function railPositions(page: Page): Promise<{ x: number; y: number }[]> {
  const rail = page.getByTestId('settings-group-nav')
  const positions: { x: number; y: number }[] = []
  for (const group of GROUPS) {
    await openSettings(page, group)
    positions.push(await stableBoundingBox(rail))
  }
  return positions
}

for (const viewport of [{ width: 1700, height: 900 }, { width: 1100, height: 800 }]) {
  test(`the group rail never moves between panes at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await gotoAppReady(page)

    const positions = await railPositions(page)
    const [first, ...rest] = positions
    const TOLERANCE_PX = 1
    for (const [index, position] of rest.entries()) {
      expect(Math.abs(position.x - first.x), `group "${GROUPS[index + 1]}" x vs "${GROUPS[0]}"`).toBeLessThanOrEqual(TOLERANCE_PX)
      expect(Math.abs(position.y - first.y), `group "${GROUPS[index + 1]}" y vs "${GROUPS[0]}"`).toBeLessThanOrEqual(TOLERANCE_PX)
    }
  })
}

// Regression: PageContainer's "narrow" variant centered the whole
// rail+pane block, leaving a floating gutter between the app sidebar
// and the group list. The rail must sit at the content area's left
// edge -- flush against the app sidebar's right edge -- not centered
// with empty space on either side.
test('the group rail sits at the content area\'s left edge, not in a centered block', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await gotoAppReady(page)
  await openSettings(page, 'general')

  const sidebar = page.getByTestId('sidebar-nav')
  const rail = page.getByTestId('settings-group-nav')
  const sidebarBox = await sidebar.boundingBox()
  if (!sidebarBox) throw new Error('expected the app sidebar to be measurable')
  const contentLeftEdge = sidebarBox.x + sidebarBox.width

  await expect
    .poll(async () => {
      const box = await rail.boundingBox()
      return box ? box.x - contentLeftEdge : Infinity
    }, { timeout: 5_000 })
    .toBeLessThanOrEqual(48)
})
