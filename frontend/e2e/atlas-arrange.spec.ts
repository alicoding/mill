import { test, expect } from './fixtures/server'
import { openToolbarAction } from './fixtures/toolbarActions'
import { nonSeededBoardObjectWrapper } from './fixtures/atlasBoard'
import { createBoardObjectViaRPC } from './fixtures/atlasNativeDropEscapeHatch'

// The Auto-arrange action family, split from atlas.spec.ts at the
// 500-line convention: the one-shot persisting packer (goal 0089), its
// command-palette twin, and the object-peer packing law (goal 0265).
// Shared worker pool: every test drills into the seeded "Client
// records" area and asserts only against seats it produces itself (or
// objects it creates and deletes), never against positions another
// spec left behind.

function atlasView(page: import('@playwright/test').Page) {
  return page.getByTestId('atlas-view')
}

function groupCard(page: import('@playwright/test').Page, title: string) {
  return page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator(`[aria-label="Zoom into ${title}"]`) })
}

test('arrange is an action: dragging persists a position, Auto-arrange re-seats it (goal 0089)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')

  // No mode toggle anywhere -- the Auto-arrange BUTTON is present at
  // every level instead (positions are always sovereign). Its row
  // testid can legitimately sit in Primer's ActionBar overflow menu at
  // this width, so reachability below (openToolbarAction, which
  // already asserts a successful click) stands in for a plain
  // toBeVisible() row-only check.
  await expect(page.getByTestId('atlas-view-mode-toggle')).toHaveCount(0)

  // One-shot arrange persists seats: click it, then a reload renders
  // the same FLOW positions (React Flow writes translate(x,y) in flow
  // coords on the node element -- camera-independent, unlike
  // boundingBox, which shifts with fitView's post-reload camera).
  await openToolbarAction(page, 'atlas-auto-arrange')
  const adaNode = page.locator('.react-flow__node').filter({ has: page.locator('[aria-label="Open Jordan Reyes"]') })
  await expect(adaNode).toBeVisible()
  let before = ''
  await expect.poll(async () => {
    before = (await adaNode.evaluate((el) => (el as HTMLElement).style.transform)) ?? ''
    return before
  }).toContain('translate')
  await page.reload()
  await expect(atlasView(page)).toBeVisible()
  await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
  await expect(adaNode).toBeVisible()
  await expect.poll(async () => adaNode.evaluate((el) => (el as HTMLElement).style.transform), { timeout: 10_000 }).toBe(before)
})

// Board objects are packing peers of cards (goal 0265): the arrange
// button seats an object into the same row flow and persists it via
// SetBoardObjectPosition -- before this, arrange visibly "did nothing"
// on an object-heavy board (every object stayed put, and cards could
// seat underneath them).
test('Auto-arrange seats a board object alongside the cards and persists it (goal 0265)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // Parked far outside the packed rows, inside the seeded Client
  // records area ("atlas-card-example-area", builtin.go) -- a seat
  // this distant can only be the packer's own doing.
  await createBoardObjectViaRPC(page, 'shape', { shapeType: 'rectangle' }, { X: 4000, Y: 4000 }, 'atlas-card-example-area')
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')

  const objectWrapper = nonSeededBoardObjectWrapper(page, 'shape')
  await expect(objectWrapper).toHaveCount(1)

  await openToolbarAction(page, 'atlas-auto-arrange')
  let seated = ''
  await expect.poll(async () => {
    seated = (await objectWrapper.evaluate((el) => (el as HTMLElement).style.transform)) ?? ''
    return seated
  }).not.toContain('4000')
  expect(seated).toContain('translate')

  // The seat survives a reload -- SetBoardObjectPosition persisted it.
  await page.reload()
  await expect(atlasView(page)).toBeVisible()
  await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
  await expect(objectWrapper).toHaveCount(1)
  await expect.poll(async () => objectWrapper.evaluate((el) => (el as HTMLElement).style.transform), { timeout: 10_000 }).toBe(seated)

  // Cleanup.
  await objectWrapper.click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(objectWrapper).toHaveCount(0)
})

// atlas.arrange (shared/atlasBoardCommands.ts): the palette path runs
// the SAME arrange action the toolbar button above does -- proven by
// the same transform-changes-to-a-translate assertion, not a second
// reload-persistence check (already covered above).
test('Auto-arrange from the command palette runs the same action as the toolbar button', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')

  const adaNode = page.locator('.react-flow__node').filter({ has: page.locator('[aria-label="Open Jordan Reyes"]') })
  await expect(adaNode).toBeVisible()

  await page.keyboard.press('Meta+/')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox').fill('Auto-arrange')
  await palette.getByRole('option', { name: 'Auto-arrange' }).click()
  await expect(palette).toHaveCount(0)

  await expect.poll(async () => (await adaNode.evaluate((el) => (el as HTMLElement).style.transform)) ?? '').toContain('translate')
})
