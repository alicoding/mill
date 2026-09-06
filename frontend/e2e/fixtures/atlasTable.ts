import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { waitForViewportStable } from './animation'
import { findEmptyBoardRect } from './atlasEmptyRegion'
import { clickBoardPoint } from './atlasBoard'
import { wheelAt } from './pointer'
import { contextMenu } from './contextMenu'
import { clickRowAction } from '../inventoryRow'
import { openConfigureKind } from './configureNav'

// Promoted (testing.md: a helper used by 2+ spec files) out of what
// used to be atlas-table-ux.spec.ts's own local copies -- every table
// state-matrix spec shares these four.
export function tableObjects(page: Page): Locator {
  return page.locator('[data-testid="atlas-board-object"][data-object-kind="table"]')
}

export async function openAtlas(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
}

// The grid claims right-click for its own row/column menus -- the
// object's own menu opens off its chrome band instead.
export async function deleteTableViaMenu(object: Locator): Promise<void> {
  const page = object.page()
  await object.getByTestId('atlas-board-object-frame').click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(object).toHaveCount(0)
}

// Escape hands the keyboard back from a table's grid to the OBJECT
// (AtlasCardProjectionTable.tsx's releaseKeyboard, goal 0273): the
// object's own canvas node takes focus, and only then does a
// board-level shortcut -- Delete/Backspace over the selection, ⌘Z over
// the journal -- reach the canvas at all. The handback is a real focus
// move one render after the keystroke, so a board shortcut sent on the
// next tick still lands in the grid; wait on the focus itself, never on
// a delay. The wait is scoped to the caller's own object via its
// ancestor node wrapper, so a board holding more than one table object
// stays unambiguous.
export async function escapeGridToObject(page: Page, object: Locator): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(object.locator('xpath=ancestor::*[contains(@class, "react-flow__node")][1]')).toBeFocused()
}

export async function deleteListNamed(page: Page, label: string): Promise<void> {
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Lists')
  const row = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText(label, { exact: true }) })
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
}

// The state-matrix audit's own screenshot capture (goal 0273's final
// slice) -- a no-op unless MILL_E2E_SHOT_DIR is set (the same opt-in
// convention composition-inspector-resize.spec.ts already uses for its
// own inspector states), so a normal CI/local run pays nothing extra;
// the audit run sets it once to collect one file per named state.
export async function tableAuditShot(page: Page, name: string): Promise<void> {
  if (!process.env.MILL_E2E_SHOT_DIR) return
  await page.screenshot({ path: `${process.env.MILL_E2E_SHOT_DIR}/${name}.png` })
}

// revealBoardObject pans the board (two-finger scroll in the default
// Trackpad mode, the zoom untouched) until the object's box sits
// inside the board's, so the caller's next measurement or forced
// click is against an on-screen, settled object. The wheel lands on
// the board's own top-left corner -- pane, never a viewer that owns
// the wheel.
// overflowDelta: how far a [lo, hi] span sticks out of [areaLo, areaHi]
// past the margin -- negative before, positive after, 0 when inside.
function overflowDelta(lo: number, hi: number, areaLo: number, areaHi: number, margin: number): number {
  if (lo < areaLo + margin) return lo - (areaLo + margin)
  if (hi > areaHi - margin) return hi - (areaHi - margin)
  return 0
}

export async function revealBoardObject(page: Page, object: Locator): Promise<void> {
  const board = page.getByTestId('atlas-board')
  for (let i = 0; i < 6; i++) {
    const box = await object.boundingBox()
    const area = await board.boundingBox()
    if (!box || !area) throw new Error('revealBoardObject: no bounding box')
    const dx = overflowDelta(box.x, box.x + box.width, area.x, area.x + area.width, 40)
    const dy = overflowDelta(box.y, box.y + box.height, area.y, area.y + area.height, 40)
    if (dx === 0 && dy === 0) return
    await wheelAt(page, board, dx, dy, { x: 24, y: 24 })
    await waitForViewportStable(board)
  }
}

// The from-a-List table door: the tray's table picker, its footer
// action, the List picker, Create. The new table lands in free space
// -- below everything on a crowded board, possibly off screen -- so
// this pans it into view (revealText names it by its own content)
// before returning.
export async function createTableFromList(page: Page, listLabel: string, revealText: string): Promise<Locator> {
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId('atlas-table-from-list').click()
  const picker = page.getByTestId('entity-ref-field')
  // The picker's options come from an async Lists() fetch fired on
  // mount (EntityRefField.tsx) -- selectOption doesn't wait for an
  // option to exist, so a slow/throttled runner can still be showing
  // "Loading…" when it fires. Wait for the real option first.
  await expect(picker.locator('option', { hasText: listLabel })).toHaveCount(1)
  await picker.selectOption({ label: listLabel })
  const create = page.getByRole('button', { name: 'Create' })
  await create.click()
  await expect(create).toHaveCount(0)
  const object = page.locator('[data-testid="atlas-board-object"][data-object-kind="table"]').filter({ hasText: revealText })
  await expect(object).toBeVisible()
  await revealBoardObject(page, object)
  await selectTableObject(object)
  return object
}

// Object first, cell second (goal 0273): a table's grid is shielded
// until the object is selected, so every caller that goes on to drive
// the grid selects the object first -- exactly the click a user makes.
export async function selectTableObject(object: Locator): Promise<void> {
  await object.click()
  await expect(object.getByTestId('atlas-object-click-shield')).toHaveCount(0)
}

// panToEmptyBoard scrolls the board (two-finger scroll, zoom
// untouched) well below the seeded content, so the visible board has
// room for a placement footprint at zoom 1 -- the default fit shows
// the seeded gallery edge to edge, with no gap a table's footprint
// fits into. Returns the empty rect a caller places into.
export async function panToEmptyBoard(page: Page, footprint: { width: number; height: number }): Promise<{ x: number; y: number }> {
  const board = page.getByTestId('atlas-board')
  await wheelAt(page, board, 0, 900, { x: 24, y: 24 })
  await waitForViewportStable(board)
  return findEmptyBoardRect(page, board, footprint.width, footprint.height)
}

// placeSizedTable arms the tray's size picker and lands the table at
// an empty spot of the board (testing.md: never a fixed pixel -- the
// shared board's contents shift between tests). Returns the new
// object by its first auto-named column.
export async function placeSizedTable(page: Page, size: '2x2' | '3x3' | '4x4' | '5x5', footprint = { width: 560, height: 220 }): Promise<Locator> {
  const spot = await panToEmptyBoard(page, footprint)
  await page.getByTestId('atlas-tray-table').click()
  await page.getByTestId(`atlas-table-size-${size}`).click()
  await clickBoardPoint(page, { x: spot.x + 12, y: spot.y + 12 })
  const object = page.locator('[data-testid="atlas-board-object"][data-object-kind="table"]').filter({ hasText: 'Column 1' })
  await expect(object).toBeVisible()
  await selectTableObject(object)
  return object
}
