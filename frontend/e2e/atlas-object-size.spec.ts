import type { Locator } from '@playwright/test'
import { test, expect } from './fixtures/server'
import { armAndPlaceTopicCard, noteCard } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'
import { blurSticky, fillSticky } from './fixtures/codeEditor'

// Shared pool (testing.md): every assertion is scoped to a card/note
// this spec creates and deletes itself.
//
// Goal 0193: a resized object's box persists, and NOTHING resizes it
// automatically -- not on entering edit, not on committing it. Reading
// a node's own computed `width`/`height` (its logical CSS box, set
// directly by React Flow's inline style) rather than boundingBox()
// keeps every assertion here independent of the board's current zoom
// (a boundingBox() reads the POST-transform painted size).
async function boxSize(el: Locator): Promise<{ width: number; height: number }> {
  return el.evaluate((node) => {
    const cs = getComputedStyle(node)
    return { width: parseFloat(cs.width), height: parseFloat(cs.height) }
  })
}

test('editing a card title or a note\'s text never resizes its board box (goal 0193)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  // Card: the inline title editor is live the instant a card is
  // placed (goal 0144) -- measure the wrapper WHILE that editor is
  // still open, then again after commit.
  await page.evaluate((kindID) => localStorage.setItem('atlas.lastKindId', kindID), 'atlas-kind-topic')
  await page.keyboard.press('c')
  const box = await board.boundingBox()
  if (!box) throw new Error('board has no bounding box')
  await board.click({ position: { x: box.width * 0.1, y: box.height * 0.1 } })
  const inline = page.getByTestId('atlas-inline-title')
  await expect(inline).toBeVisible()
  const cardWrapper = page.locator('.react-flow__node').filter({ has: inline })
  const duringEdit = await boxSize(cardWrapper)
  await inline.fill('ZzSizeCardEdit')
  await inline.press('Enter')
  const card = noteCard(page, 'ZzSizeCardEdit')
  await expect(card).toBeVisible()
  const afterCommit = await boxSize(page.locator('.react-flow__node').filter({ has: card }))
  expect(afterCommit).toEqual(duringEdit)

  // Note: place, commit, THEN re-edit an EXISTING note (regression --
  // goal 0145 used to grow this box on edit entry and snap it back on
  // commit; goal 0193 says neither may happen).
  await page.keyboard.press('n')
  await board.click({ position: { x: box.width * 0.6, y: box.height * 0.1 } })
  await fillSticky(page, 'ZzSizeNoteEdit')
  await blurSticky(page)
  const sticky = page.locator('[data-testid="atlas-sticky-note"][data-editing="false"]').filter({ hasText: 'ZzSizeNoteEdit' })
  await expect(sticky).toBeVisible()
  const restingSize = await boxSize(page.locator('.react-flow__node').filter({ has: sticky }))
  await sticky.dblclick()
  const reEditing = page.locator('[data-testid="atlas-sticky-note"][data-editing="true"]')
  await expect(reEditing).toBeVisible()
  const editingSize = await boxSize(page.locator('.react-flow__node').filter({ has: reEditing }))
  expect(editingSize).toEqual(restingSize)
  await page.keyboard.press('Escape')

  // Cleanup (testing.md's within-file discipline).
  await card.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(card).toHaveCount(0)
  await page.locator('[data-testid="atlas-sticky-note"]').filter({ hasText: 'ZzSizeNoteEdit' }).click({ button: 'right' })
  await expect(menu).toBeVisible()
  await menu.getByText('Delete note', { exact: true }).click()
  await expect(page.locator('[data-testid="atlas-sticky-note"]').filter({ hasText: 'ZzSizeNoteEdit' })).toHaveCount(0)
})

// Fit to content (goal 0193's own "expand to the point you can see the
// remaining content" action) is a plain menu click -- no drag
// synthesis, so it also stands in for the CI-safe half of "resize
// persists across reload" (the actual resize-HANDLE drag is the same
// documented pointer-coalescing class as QUARANTINE.md's
// atlas-table-resize, local-only, covered separately below).
test('fit to content reveals a clipped title and the new size survives reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const longTitle = ('ZzSizeFit ' + 'word '.repeat(15)).trim()
  await armAndPlaceTopicCard(page, board, page.getByTestId('atlas-placement-popover'), 0.1, 0.1, longTitle)
  const card = noteCard(page, longTitle)
  await expect(card).toBeVisible()
  const title = card.locator('div').filter({ hasText: longTitle }).first()

  // At the default box the title is genuinely clipped (its natural
  // content needs more vertical room than the box currently has).
  const clipped = await title.evaluate((el) => el.scrollHeight - el.clientHeight)
  expect(clipped).toBeGreaterThan(0)

  await card.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Fit to content', { exact: true }).click()

  // The clip gap closes -- the box now shows everything.
  await expect.poll(() => title.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1)
  const fitted = await boxSize(page.locator('.react-flow__node').filter({ has: card }))

  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(card).toBeVisible()
  const afterReload = await boxSize(page.locator('.react-flow__node').filter({ has: card }))
  expect(afterReload).toEqual(fitted)

  await card.click({ button: 'right' })
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(card).toHaveCount(0)
})

// Local-only (QUARANTINE.md's atlas-table-resize class: synthesized
// pointermove deltas coalesce on CI runners, producing zero growth).
// Note.Size's own round-trip is Go-tested (TestSetNoteSize); this pins
// the interaction wiring (NodeResizer -> SetNoteSize -> reload).
test('dragging a note\'s resize handle persists Note.Size across reload', async ({ page }) => {
  test.skip(!!process.env.CI, 'drag synthesis coalesces on CI -- QUARANTINE.md atlas-table-resize')
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await page.keyboard.press('n')
  const box = await board.boundingBox()
  if (!box) throw new Error('board has no bounding box')
  await board.click({ position: { x: box.width * 0.15, y: box.height * 0.6 } })
  await fillSticky(page, 'ZzSizeNoteDrag')
  await blurSticky(page)
  const sticky = page.locator('[data-testid="atlas-sticky-note"]').filter({ hasText: 'ZzSizeNoteDrag' })
  await expect(sticky).toBeVisible()
  const before = await boxSize(page.locator('.react-flow__node').filter({ has: sticky }))

  await sticky.click()
  const handle = page.locator('.react-flow__resize-control.handle.top.right')
  await expect(handle).toBeVisible()
  const hb = await handle.boundingBox()
  if (!hb) throw new Error('no resize handle box')
  const startX = hb.x + hb.width / 2
  const startY = hb.y + hb.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(startX + i * 20, startY - i * 10)
    await page.waitForTimeout(50) // pointer-coalescing class (see header comment) -- one real frame per step
  }
  await page.mouse.up()

  await expect.poll(async () => (await boxSize(page.locator('.react-flow__node').filter({ has: sticky }))).width).toBeGreaterThan(before.width + 80)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(sticky).toBeVisible()
  const afterReload = await boxSize(page.locator('.react-flow__node').filter({ has: sticky }))
  expect(afterReload.width).toBeGreaterThan(before.width + 80)

  await sticky.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete note', { exact: true }).click()
  await expect(sticky).toHaveCount(0)
})
