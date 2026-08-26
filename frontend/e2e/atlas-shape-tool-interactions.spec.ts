import { test, expect } from './fixtures/server'
import { dragBetween, dragResizeHandle, nonSeededBoardObjects, nonSeededBoardObjectWrapper } from './fixtures/atlasBoard'
import { findEmptyBoardRect } from './fixtures/atlasEmptyRegion'
import { deleteViaContextMenu, shapeDrawPoints, shapeObjects } from './fixtures/atlasShapeTool'
import { contextMenu } from './fixtures/contextMenu'
import { waitForViewportStable } from './fixtures/animation'

// The shape tool's own interaction-physics tests (goal 0169 slice 5,
// goal 0206, goal 0208, goal 0213), split out of atlas-shape-tool.spec.ts
// once the fixed-pixel -> findEmptyBoardRect migration (goal 0223's
// class fix) pushed that file over the 500-line cap. Shares
// fixtures/atlasShapeTool.ts's helpers with it.

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
  const picker = page.getByTestId('atlas-shape-style-picker')
  const draw = await shapeDrawPoints(page, board, picker)
  await dragBetween(page, draw.from, draw.to)
  const shapes = shapeObjects(page)
  await expect(shapes).toHaveCount(1)
  const wrapper = nonSeededBoardObjectWrapper(page, 'shape')
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
  await dragBetween(page, { locator: shapes.first(), position: { x: beforeDrag.width / 2, y: beforeDrag.height / 2 } }, { x: beforeDrag.x + beforeDrag.width / 2 + 100, y: beforeDrag.y + beforeDrag.height / 2 + 80 })
  await expect.poll(async () => (await shapes.first().boundingBox())?.x ?? 0).toBeGreaterThan(beforeDrag.x + 60)

  // Resize it by a handle -- still selected from the drag above, no
  // click needed to reach the handles.
  const beforeResize = await shapes.first().boundingBox()
  if (!beforeResize) throw new Error('no shape box before resize')
  const handle = page.locator('.react-flow__resize-control.handle.top.right')
  await expect(handle).toBeVisible()
  let midDragChecked = false
  // Defect 3, mid-drag: NodeResizer only ever WRITES Size at
  // onResizeEnd, but the paint must already track the pointer here,
  // not just at release -- the node's live box and the SVG's own
  // rendered box must already agree, mid-gesture.
  await dragResizeHandle(page, handle, 90, -60, 6, async (i) => {
    if (i !== 3) return
    const nodeMidDrag = await wrapper.boundingBox()
    const svgMidDrag = await shapes.first().locator('[data-testid="atlas-shape-content"]').boundingBox()
    if (nodeMidDrag && svgMidDrag) {
      expect(svgMidDrag.width).toBeLessThanOrEqual(nodeMidDrag.width + 2)
      expect(svgMidDrag.height).toBeLessThanOrEqual(nodeMidDrag.height + 2)
      midDragChecked = true
    }
  })
  expect(midDragChecked, 'mid-drag geometry sample never landed -- the live-tracking assertion needs at least one').toBe(true)
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

// Goal 0208 defect 4, traced live: React Flow's own elevateNodesOnSelect
// (default true, never overridden until this goal) bumps whichever
// node is SELECTED to a z far above any declared value -- a just-drawn
// shape stays selected (goal 0199's own one-shot contract), so ink
// UNDER it painted BEHIND it despite OBJECT_Z_INDEX ranking ink above
// shape (confirmed live: the selected shape's rendered node carried
// style.zIndex "1000" against ink's own declared "1"). Ink is drawn
// FIRST here, the shape SECOND, on purpose: React Flow fires a real
// deselecting pane click at the end of any drag that starts on empty
// canvas (the nearest-common-ancestor rule for a mousedown/mouseup
// pair with different targets), which a continuous tool like pencil
// has no mechanism to recover from -- but Shape's own commit
// (onShapeCreated, goal 0199) RE-SELECTS the object it just made
// asynchronously, after that click has already resolved, so drawing
// the shape LAST is what makes "still selected" the real, deterministic
// end state -- matching the reported sequence of draw a shape, then
// draw ink (0199 already proved shape's own selection survives past
// its own commit; this only adds ink underneath it).
// Pins the fixed property directly against each node's own RENDERED
// z-index (what actually decides paint order), not just the declared
// OBJECT_Z_INDEX map, since a passing map with a broken render would
// otherwise go unnoticed -- deliberately not a document.elementFromPoint
// probe at one pixel, which flaked against the free-hand stroke's own
// sub-pixel thickness.
test('ink under a shape paints above it, even while the shape stays selected', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  // Ink and shape are drawn to deliberately CROSS each other, so both
  // points are derived from ONE empty region's own origin rather than
  // independent findEmptyBoardRect calls -- a second call would treat
  // the just-drawn ink as occupied and steer the shape clear of it,
  // defeating the overlap this test exists to prove. Points are
  // board-relative DragEndpoints, not page-absolute -- dragBetween's
  // own hover() re-reads the board's box at the moment it actually
  // fires, self-correcting for any layout shift between this scan and
  // the real pointer-down (goal 0223's own regression: an absolute
  // point captured once went stale against the tray/picker's own arm
  // animation).
  const origin = await findEmptyBoardRect(page, board, 260, 200)
  const boardBox = await board.boundingBox()
  if (!boardBox) throw new Error('board has no bounding box')
  const relPoint = (x: number, y: number) => ({ locator: board, position: { x: x - boardBox.x, y: y - boardBox.y } })
  await page.getByTestId('atlas-tray-pencil').click()
  await dragBetween(page, relPoint(origin.x + 20, origin.y + 90), relPoint(origin.x + 220, origin.y + 90))
  const ink = nonSeededBoardObjects(page, 'ink')
  await expect(ink).toHaveCount(1)
  const inkWrapper = nonSeededBoardObjectWrapper(page, 'ink')
  await page.keyboard.press('Escape')

  await page.getByTestId('atlas-tray-shape').click()
  await dragBetween(page, relPoint(origin.x + 40, origin.y + 20), relPoint(origin.x + 200, origin.y + 160))
  const shapes = shapeObjects(page)
  await expect(shapes).toHaveCount(1)
  const shapeWrapper = nonSeededBoardObjectWrapper(page, 'shape')
  // Left selected by goal 0199's own one-shot contract -- exactly the
  // state elevateNodesOnSelect used to break ink's own z tier against.
  await expect(shapeWrapper).toHaveClass(/selected/)

  const inkZ = Number(await inkWrapper.evaluate((el) => (el as HTMLElement).style.zIndex || '0'))
  const shapeZ = Number(await shapeWrapper.evaluate((el) => (el as HTMLElement).style.zIndex || '0'))
  expect(inkZ, 'ink must paint above a shape it crosses, even while the shape stays selected').toBeGreaterThan(shapeZ)

  await deleteViaContextMenu(page, ink)
  await deleteViaContextMenu(page, shapes.first())
  await expect(shapes).toHaveCount(0)
})

// Goal 0208 defect 1's own precedence rule ("armed tool wins
// everywhere"): a selected shape's resize handles carry their own
// directional resize cursor when nothing is armed, but must read as
// the armed tool the instant one is -- otherwise a user resizing,
// then reaching for the pencil without deselecting, would see a
// misleading resize cursor over what is now a draw surface.
test('the armed cursor beats a selected shape\'s own resize-handle cursor, and the handle\'s cursor returns once disarmed', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await page.getByTestId('atlas-tray-shape').click()
  const picker = page.getByTestId('atlas-shape-style-picker')
  const draw = await shapeDrawPoints(page, board, picker)
  await dragBetween(page, draw.from, draw.to)
  const shapes = shapeObjects(page)
  await expect(shapes).toHaveCount(1)
  const wrapper = nonSeededBoardObjectWrapper(page, 'shape')
  await expect(wrapper).toHaveClass(/selected/)

  const handle = page.locator('.react-flow__resize-control.handle.top.right')
  await expect(handle).toBeVisible()

  // Shape disarmed itself on commit (goal 0199) -- nothing is armed,
  // so the handle's own resize cursor applies.
  await handle.hover()
  expect(await handle.evaluate((el) => getComputedStyle(el).cursor)).toBe('nesw-resize')

  // Arm pencil while the shape stays selected: the armed tool wins
  // everywhere, including over the handle it's hovering.
  await page.getByTestId('atlas-tray-pencil').click()
  await handle.hover()
  expect(await handle.evaluate((el) => getComputedStyle(el).cursor)).toBe('crosshair')

  await page.keyboard.press('Escape')
  await handle.hover()
  expect(await handle.evaluate((el) => getComputedStyle(el).cursor)).toBe('nesw-resize')

  await deleteViaContextMenu(page, shapes.first())
  await expect(shapes).toHaveCount(0)
})

// Goal 0213 (same class as atlas-pencil-tool.spec.ts's own overlap
// test): a second draw's start point landing on shape A's own box must
// draw shape B without moving or re-selecting A.
test('starting a second shape draw on top of the first one draws without dragging it', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await waitForViewportStable(board)
  const shapeTool = page.getByTestId('atlas-tray-shape')
  await shapeTool.click()
  const picker = page.getByTestId('atlas-shape-style-picker')
  const draw = await shapeDrawPoints(page, board, picker)
  await dragBetween(page, draw.from, draw.to)
  const shapes = shapeObjects(page)
  await expect(shapes).toHaveCount(1)
  const shapeAHandle = await nonSeededBoardObjectWrapper(page, 'shape').elementHandle()
  if (!shapeAHandle) throw new Error('shape A node has no element handle')
  const shapeABox = await shapeAHandle.boundingBox()
  if (!shapeABox) throw new Error('shape A node has no bounding box')
  const initialTransform = await shapeAHandle.evaluate((el) => (el as HTMLElement).style.transform)
  await shapeTool.click() // discrete tool (goal 0199): needs a fresh arm
  const startX = shapeABox.x + shapeABox.width * 0.5
  const startY = shapeABox.y + shapeABox.height * 0.5
  await dragBetween(page, { x: startX, y: startY }, { x: startX + 40, y: startY + 40 })
  await expect(shapes).toHaveCount(2)
  await expect.poll(() => shapeAHandle.evaluate((el) => (el as HTMLElement).style.transform)).toBe(initialTransform)
  // Fresh boxes read at click time (a stale coordinate already proved
  // flaky) -- B's far corner and A's near corner stay clear of each
  // other by construction of the drag direction.
  const shapeAID = await shapeAHandle.evaluate((el) => el.getAttribute('data-id'))
  // The has: needle stays descendant-only (nonSeededBoardObjectWrapper's
  // own comment explains why reusing `shapes`' full ancestor-prefixed
  // selector here would never match).
  const shapeB = page.locator(`.react-flow__node[data-id]:not([data-id="${shapeAID}"])`).filter({ has: page.locator('[data-testid="atlas-board-object"][data-object-kind="shape"]') })
  const shapeBBox = await shapeB.boundingBox()
  if (!shapeBBox) throw new Error('shape B has no box')
  await deleteViaContextMenu(page, shapeB, { x: shapeBBox.width - 5, y: shapeBBox.height - 5 })
  await expect(shapes).toHaveCount(1)
  await shapeAHandle.click({ button: 'right', position: { x: 5, y: 5 } })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(shapes).toHaveCount(0)
})
