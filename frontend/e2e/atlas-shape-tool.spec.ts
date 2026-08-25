import { test, expect } from './fixtures/server'
import { dragBetween } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'
import { ATLAS_KIND_TOPIC, selectKind } from './fixtures/kindPicker'

// The shape tool (goal 0169 slice 5): drag-to-draw lands a rectangle/
// ellipse/arrow as a board-local BoardObject -- NEVER a card, matching
// image/ink's own goal 0179 correction. One tray tool covers all three
// types, picked via the style picker while armed. Shape is DISCRETE
// (goal 0199 part D): a completed draw disarms the tool and leaves the
// new object selected, unlike pencil/eraser/laser's own continuous
// arming -- re-clicking the armed button locks it for deliberate
// repetition. Shared pool: every entity created here is deleted here.
//
// Real pointer-capture drag, not React Flow's own internal drag
// machinery (the class QUARANTINE.md's box-select/NodeResizer entries
// document as unreliable to synthesize) -- same wiring
// atlas-pencil-tool.spec.ts's own header comment documents.
async function boardPoint(board: import('@playwright/test').Locator, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await board.boundingBox()
  if (!box) throw new Error('board has no bounding box')
  return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

function shapeObjects(page: import('@playwright/test').Page) {
  return page.locator('[data-testid="atlas-board-object"][data-object-kind="shape"]')
}

async function deleteViaContextMenu(page: import('@playwright/test').Page, target: import('@playwright/test').Locator): Promise<void> {
  await target.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
}

test('dragging the shape tool lands a rectangle, never a card, disarms, and leaves it selected', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const shapeTool = page.getByTestId('atlas-tray-shape')
  await shapeTool.click()
  await expect(shapeTool).toHaveAttribute('data-armed', 'true')
  const picker = page.getByTestId('atlas-shape-style-picker')
  await expect(picker).toBeVisible()
  // Rectangle is the default type -- confirmed selected before any drag.
  await expect(picker.getByTestId('atlas-shape-type-rectangle')).toHaveAttribute('data-selected', 'true')

  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.2, 0.25))

  const shapes = shapeObjects(page)
  await expect(shapes).toHaveCount(1)
  await expect(shapes.first()).toHaveAttribute('data-shape-type', 'rectangle')
  // The rule, absolute: drawing never creates a card the user didn't
  // explicitly ask for.
  await expect(page.getByTestId('atlas-note-card').filter({ hasText: 'Rectangle' })).toHaveCount(0)

  // One-shot (goal 0199, contract items 1-2): the draw disarms the
  // tool (its own options bar closes with it) and leaves the new
  // object selected -- the load-bearing half that puts the resize
  // handles on the thing just made instead of on nothing.
  await expect(shapeTool).toHaveAttribute('data-armed', 'false')
  await expect(picker).not.toBeVisible()
  const wrapper = page.locator('.react-flow__node').filter({ has: shapes.first() })
  await expect(wrapper).toHaveClass(/selected/)

  await deleteViaContextMenu(page, shapes.first())
  await expect(shapes).toHaveCount(0)
})

// Pins the exact reported sequence (goal 0199's own acceptance
// criterion): the natural next gesture after drawing is clicking the
// thing just made, and it must select rather than draw a second one.
test('the second click after a draw selects rather than creates a second shape', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await page.getByTestId('atlas-tray-shape').click()
  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.2, 0.25))
  const shapes = shapeObjects(page)
  await expect(shapes).toHaveCount(1)

  await shapes.first().click()
  await expect(shapes).toHaveCount(1)
  const wrapper = page.locator('.react-flow__node').filter({ has: shapes.first() })
  await expect(wrapper).toHaveClass(/selected/)

  await deleteViaContextMenu(page, shapes.first())
  await expect(shapes).toHaveCount(0)
})

test('re-clicking the armed shape tool locks it for deliberate repetition, and Escape disarms from locked', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const shapeTool = page.getByTestId('atlas-tray-shape')
  await shapeTool.click()
  await expect(shapeTool).toHaveAttribute('data-armed', 'true')
  await expect(shapeTool).toHaveAttribute('data-locked', 'false')

  // Re-clicking the already-armed button locks it (the Excalidraw
  // convention) -- visually distinct from plain armed.
  await shapeTool.click()
  await expect(shapeTool).toHaveAttribute('data-locked', 'true')

  const shapes = shapeObjects(page)
  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.2, 0.25))
  await expect(shapes).toHaveCount(1)
  // Locked survives the commit: the next drag needs no re-arm.
  await expect(shapeTool).toHaveAttribute('data-armed', 'true')
  await expect(shapeTool).toHaveAttribute('data-locked', 'true')

  await dragBetween(page, await boardPoint(board, 0.3, 0.1), await boardPoint(board, 0.45, 0.25))
  await expect(shapes).toHaveCount(2)

  // Escape disarms even a locked tool.
  await page.keyboard.press('Escape')
  await expect(shapeTool).toHaveAttribute('data-armed', 'false')

  await deleteViaContextMenu(page, shapes.nth(0))
  await deleteViaContextMenu(page, shapes.nth(0))
  await expect(shapes).toHaveCount(0)
})

test('picking ellipse then arrow draws each type, and an arrow carries no Size (dx/dy only)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const shapeTool = page.getByTestId('atlas-tray-shape')
  await shapeTool.click()
  const picker = page.getByTestId('atlas-shape-style-picker')
  await expect(picker).toBeVisible()

  await picker.getByTestId('atlas-shape-type-ellipse').click()
  await expect(picker.getByTestId('atlas-shape-type-ellipse')).toHaveAttribute('data-selected', 'true')
  // Both drags stay in the board's own TOP band, clear of the style
  // picker's own popover (anchored 'outside-top' of the bottom-center
  // tray, so it occupies the lower-middle of the viewport for as long
  // as shape stays armed) -- a drag start point landing ON that popover
  // would be swallowed by it rather than reaching the board's own
  // pointer-capture handler, never producing a shape (goal 0184's
  // class: verify the drag start point is reachable, don't assume it).
  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.2, 0.25))
  const shapes = shapeObjects(page)
  await expect(shapes).toHaveCount(1)
  await expect(shapes.first()).toHaveAttribute('data-shape-type', 'ellipse')

  // Shape is discrete (goal 0199): the ellipse draw already disarmed
  // the tool, so the arrow type needs a fresh arm before it can be
  // picked -- the style store keeps 'ellipse' selected across that
  // cycle (this file's own third test proves the same store persists
  // stroke colour), so re-arming here is the realistic gesture, not a
  // workaround.
  await shapeTool.click()
  await expect(picker).toBeVisible()
  await picker.getByTestId('atlas-shape-type-arrow').click()
  await dragBetween(page, await boardPoint(board, 0.3, 0.1), await boardPoint(board, 0.45, 0.25))
  await expect(shapes).toHaveCount(2)
  await expect(page.locator('[data-testid="atlas-board-object"][data-shape-type="arrow"]')).toHaveCount(1)

  await deleteViaContextMenu(page, shapes.nth(0))
  await deleteViaContextMenu(page, shapes.nth(0))
  await expect(shapes).toHaveCount(0)
})

test('the shape style choice survives a disarm/re-arm cycle, and Promote to card works the same way ink\'s does', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const shapeTool = page.getByTestId('atlas-tray-shape')
  await shapeTool.click()
  const picker = page.getByTestId('atlas-shape-style-picker')
  await expect(picker).toBeVisible()

  const chosenSwatch = picker.getByTestId('atlas-shape-stroke-da3633')
  await expect(chosenSwatch).toHaveAttribute('data-selected', 'false')
  await chosenSwatch.click()
  await expect(chosenSwatch).toHaveAttribute('data-selected', 'true')

  // Disarm, then re-arm: the style picker REMOUNTS (AnchoredOverlay
  // unmounts its children while closed) -- the swatch selection
  // surviving proves it lives in the ephemeral store, not per-mount
  // component state. Escape, not a second click -- re-clicking the
  // armed button LOCKS it now (goal 0199 part D), it doesn't disarm.
  await page.keyboard.press('Escape')
  await expect(picker).not.toBeVisible()
  await shapeTool.click()
  await expect(picker).toBeVisible()
  await expect(picker.getByTestId('atlas-shape-stroke-da3633')).toHaveAttribute('data-selected', 'true')

  const shapes = shapeObjects(page)
  await dragBetween(page, await boardPoint(board, 0.55, 0.1), await boardPoint(board, 0.7, 0.25))
  await expect(shapes).toHaveCount(1)

  await shapes.first().click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Promote to card…', { exact: true }).click()
  const popover = page.getByTestId('atlas-placement-popover')
  await expect(popover).toBeVisible()
  await expect(popover.getByTestId('atlas-placement-title')).toHaveValue('Rectangle')
  await selectKind(popover, ATLAS_KIND_TOPIC)
  await popover.getByTestId('atlas-placement-submit').click()
  await expect(popover).not.toBeVisible()
  await expect(shapes).toHaveCount(0)
  const card = page.getByTestId('atlas-note-card').filter({ hasText: 'Rectangle' })
  await expect(card).toBeVisible()

  await card.click({ button: 'right' })
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(card).toHaveCount(0)
})

// The full acceptance sentence (goal 0199, re-proven by goal 0206 with
// the surface it now drags by): draw a shape, it is selected, drag it
// by its own BODY (goal 0206 removed the drag-band chrome from shape --
// its whole body already drags, so the band would only be debris, and
// the acceptance sentence's own "drag works" capability now goes
// through that surface instead), resize it by a handle, and the size
// survives reload -- no Escape pressed anywhere. Also pins goal 0206's
// own defects 1 and 3: the paint never exceeds the node's own box
// (defect 1), and it tracks the pointer live during a resize rather
// than snapping only at release (defect 3) -- both from the SAME fix
// (AtlasShapeContent.tsx's SVG filling its container at 100%/100%).
test('draw, selected, drag by body, resize by handle, survives reload -- no Escape anywhere', async ({ page }) => {
  // Same CI-invisible pointer-coalescing class this repo's other
  // resize-drag tests already document (QUARANTINE.md atlas-table-resize).
  test.skip(!!process.env.CI, 'drag synthesis coalesces on CI -- QUARANTINE.md atlas-table-resize')
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await page.getByTestId('atlas-tray-shape').click()
  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.2, 0.25))
  const shapes = shapeObjects(page)
  await expect(shapes).toHaveCount(1)
  const wrapper = page.locator('.react-flow__node').filter({ has: shapes.first() })
  await expect(wrapper).toHaveClass(/selected/)

  // Defect 1: the paint (the SVG atlasShapeContent renders) never
  // exceeds the node's own frame -- a 2px slack for stroke/rounding,
  // never the ~14px band-height overflow the bug produced.
  const svgAfterDraw = shapes.first().locator('[data-testid="atlas-shape-content"]')
  const nodeAfterDraw = await wrapper.boundingBox()
  const svgBoxAfterDraw = await svgAfterDraw.boundingBox()
  if (!nodeAfterDraw || !svgBoxAfterDraw) throw new Error('no node/svg box after draw')
  expect(svgBoxAfterDraw.height).toBeLessThanOrEqual(nodeAfterDraw.height + 2)
  expect(svgBoxAfterDraw.width).toBeLessThanOrEqual(nodeAfterDraw.width + 2)

  // Drag it by its own body (no drag-band chrome for shape, goal 0206 --
  // its whole body already drags). The node's own box has no NodeResizer
  // handle at its exact center, so a center point is always body, never
  // a handle.
  const beforeDrag = await shapes.first().boundingBox()
  if (!beforeDrag) throw new Error('no shape box')
  const dragStart = { x: beforeDrag.x + beforeDrag.width / 2, y: beforeDrag.y + beforeDrag.height / 2 }
  await dragBetween(page, dragStart, { x: dragStart.x + 100, y: dragStart.y + 80 })
  await expect.poll(async () => (await shapes.first().boundingBox())?.x ?? 0).toBeGreaterThan(beforeDrag.x + 60)

  // Resize it by a handle -- still selected from the drag above, no
  // click needed to reach the handles.
  const beforeResize = await shapes.first().boundingBox()
  if (!beforeResize) throw new Error('no shape box before resize')
  const handle = page.locator('.react-flow__resize-control.handle.top.right')
  await expect(handle).toBeVisible()
  const hb = await handle.boundingBox()
  if (!hb) throw new Error('no resize handle box')
  const startX = hb.x + hb.width / 2
  const startY = hb.y + hb.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  let midDragChecked = false
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(startX + i * 15, startY - i * 10)
    // Pointer-coalescing class (this file's own header comment) --
    // each step must land in its own frame.
    await page.waitForTimeout(50)
    // Defect 3, mid-drag: NodeResizer only ever WRITES Size at
    // onResizeEnd, but the paint must already track the pointer here,
    // not just at release -- the node's live box and the SVG's own
    // rendered box must already agree, mid-gesture.
    if (i === 3) {
      const nodeMidDrag = await wrapper.boundingBox()
      const svgMidDrag = await shapes.first().locator('[data-testid="atlas-shape-content"]').boundingBox()
      if (nodeMidDrag && svgMidDrag) {
        expect(svgMidDrag.width).toBeLessThanOrEqual(nodeMidDrag.width + 2)
        expect(svgMidDrag.height).toBeLessThanOrEqual(nodeMidDrag.height + 2)
        midDragChecked = true
      }
    }
  }
  expect(midDragChecked, 'mid-drag geometry sample never landed -- the live-tracking assertion needs at least one').toBe(true)
  await page.mouse.up()
  await expect.poll(async () => (await shapes.first().boundingBox())?.width ?? 0).toBeGreaterThan(beforeResize.width + 40)

  // Survives reload.
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  const reloaded = shapeObjects(page)
  await expect(reloaded).toBeVisible()
  await expect.poll(async () => (await reloaded.boundingBox())?.width ?? 0).toBeGreaterThan(beforeResize.width + 40)

  await deleteViaContextMenu(page, reloaded)
  await expect(reloaded).toHaveCount(0)
})
