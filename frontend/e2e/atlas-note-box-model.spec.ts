import { test } from './fixtures/server'
import { expect } from '@playwright/test'
import { deleteSticky, dragResizeHandle } from './fixtures/atlasBoard'
import { findEmptyBoardPoint, placeNoteClear } from './fixtures/atlasEmptyRegion'
import { fillSticky, stickyEditor, blurSticky } from './fixtures/codeEditor'

// The note's box model and resize/edit interaction contract (goal
// 0248): content-driven height with a floor and a cap, corner-square
// resize handles, an edit session no resize drag can end, and a
// usable default footprint. Split from atlas-note-markdown.spec.ts
// along the rendering-vs-box-model seam (500-line convention).
// Shared worker pool: every note created here is deleted before its
// test ends.

// Regression (owner-reported live: a note's box snapped small on
// commit, clipping its own second line): the note's box height is
// content-driven in BOTH the editing and at-rest render, floored by a
// min-height, never a fixed clamp -- entering/leaving edit never snaps
// the box smaller than its own content.
test('a note holding two lines fits both, no invisible clip at rest', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await placeNoteClear(page, board)
  await expect(stickyEditor(page)).toBeVisible()

  const editable = stickyEditor(page).locator('[contenteditable="true"]')
  await editable.click()
  await page.keyboard.type('# Plan')
  await page.keyboard.press('Enter')
  await page.keyboard.type('some text here')

  const sticky = page.getByTestId('atlas-sticky-note')
  const editingBox = await sticky.boundingBox()
  if (!editingBox) throw new Error('sticky has no bounding box while editing')

  // A real outside press commits it (the pointer-driven contract) --
  // the same "click away" gesture the live repro used, not a
  // keyboard shortcut. An EMPTY pane point, never a corner: a corner
  // press can land on a seeded card's own drill door, silently
  // changing the restored session level for every later test on this
  // worker.
  const away = await findEmptyBoardPoint(page, board, [sticky])
  const awayBase = await board.boundingBox()
  if (!awayBase) throw new Error('board has no bounding box')
  await board.click({ position: { x: away.x - awayBase.x, y: away.y - awayBase.y } })
  await expect(stickyEditor(page)).toHaveCount(0)

  await expect(sticky.locator('h1')).toHaveText('Plan')
  const secondLine = sticky.locator('p', { hasText: 'some text here' })
  await expect(secondLine).toBeVisible()

  const restBox = await sticky.boundingBox()
  const lineBox = await secondLine.boundingBox()
  if (!restBox || !lineBox) throw new Error('missing a bounding box at rest')

  // No edit -> rest size snap: the box never shrinks on commit.
  expect(restBox.height).toBeGreaterThanOrEqual(editingBox.height - 2)
  // The N1 pin: the second line's own box is fully CONTAINED within
  // the note's box, not clipped past its bottom edge -- the exact
  // defect measured live (the line existed in the DOM but sat below
  // the visible, clipped box).
  expect(lineBox.y + lineBox.height).toBeLessThanOrEqual(restBox.y + restBox.height + 1)

  await deleteSticky(page, sticky)
})

// Regression (owner-reported live: the resize handles rendered as four
// 514x5px full-width blue bars instead of small corner squares, ONLY
// while a note was selected AND focused for editing -- selected-but-
// not-editing measured fine): AtlasStickyNode.module.css's own
// `.sticky.editing > *` rule used to catch the library's own
// unwrapped `.react-flow__resize-control` elements (rendered as DIRECT
// children of the editing wrapper, no wrapping element of their own),
// forcing every handle to the note's own width.
test('resize handles are small corner squares while editing and selected, never full-width bars', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await placeNoteClear(page, board)
  await fillSticky(page, 'Handle check')
  await blurSticky(page)

  const sticky = page.getByTestId('atlas-sticky-note')
  await sticky.dblclick()
  await expect(stickyEditor(page)).toBeVisible()

  const handles = page.locator('.react-flow__resize-control.handle')
  await expect(handles.first()).toBeVisible()
  const count = await handles.count()
  expect(count).toBeGreaterThan(0)
  for (let i = 0; i < count; i++) {
    const box = await handles.nth(i).boundingBox()
    if (!box) throw new Error('resize handle has no bounding box')
    expect(box.width).toBeLessThanOrEqual(12)
  }

  await blurSticky(page)
  await deleteSticky(page, sticky)
})

// Regression (owner-reported live: dragging a resize handle dropped
// the contenteditable's own focus, ending the edit session mid-drag):
// the resize handles are excluded from the outside-press "commit"
// detection, a press on a handle keeps its mousedown default
// suppressed so DOM focus never leaves the contenteditable at all,
// and the capture/restore pair covers any refresh-driven editor
// remount landing right after the drag (AtlasStickyNode.tsx's
// captureResizeFocus/restoreResizeFocus).
test('a resize drag never breaks the edit session -- the editor stays focused after mouseup', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await placeNoteClear(page, board)
  await fillSticky(page, 'Resize me')
  await blurSticky(page)

  const sticky = page.getByTestId('atlas-sticky-note')
  await sticky.dblclick()
  await expect(stickyEditor(page)).toBeVisible()
  const editable = stickyEditor(page).locator('[contenteditable="true"]')
  await expect(editable).toBeFocused()

  const handle = page.locator('.react-flow__resize-control.handle.bottom.right')
  await dragResizeHandle(page, handle, 40, 30)

  // Still editing, same contenteditable still focused -- the drag
  // never committed/unmounted the edit session.
  await expect(stickyEditor(page)).toBeVisible()
  await expect(editable).toBeFocused()

  await blurSticky(page)
  await deleteSticky(page, sticky)
})

// Regression (owner-reported live: a freshly click-placed note landed
// at 79x54px, a sliver too small to read): the note tool's own default
// footprint (atlasBoardLayout.ts's STICKY_WIDTH) is a usable width, and
// the editor autofocuses immediately on placement.
test('a fresh note lands at a usable default width, editor focused', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await placeNoteClear(page, board)

  const editor = stickyEditor(page)
  await expect(editor).toBeVisible()
  const editable = editor.locator('[contenteditable="true"], textarea')
  await expect(editable).toBeFocused()

  // FLOW units via the node wrapper's own inline width, not a screen
  // bounding box -- the restored session level varies the zoom, and a
  // screen-pixel read of the same footprint shrinks with it.
  const wrapper = page.locator('.react-flow__node:has([data-testid="atlas-sticky-note"])')
  const flowWidth = await wrapper.evaluate((el) => parseFloat((el as HTMLElement).style.width))
  expect(flowWidth).toBeGreaterThanOrEqual(200)

  // Escape cancels the still-unpersisted draft -- nothing to clean up.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('atlas-sticky-note')).toHaveCount(0)
})
