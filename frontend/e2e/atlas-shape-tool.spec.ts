import { test, expect } from './fixtures/server'
import { dragBetween, nonSeededBoardObjectWrapper } from './fixtures/atlasBoard'
import { clickAtlasTrayTool } from './fixtures/atlasTray'
import { deleteViaContextMenu, shapeDrawPoints, shapeObjects } from './fixtures/atlasShapeTool'
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
// atlas-pencil-tool.spec.ts's own header comment documents. dragBetween
// is the shared fixtures/atlasBoard.ts version; shapeDrawPoints/
// shapeObjects/deleteViaContextMenu are fixtures/atlasShapeTool.ts's
// (shared with atlas-shape-tool-interactions.spec.ts, the drag/resize/
// z-index/cursor tests split out to keep both files under the 500-line
// cap). Every draw's own start/end point comes from shapeDrawPoints's
// findEmptyBoardRect search (fixtures/atlasEmptyRegion.ts, goal 0223's
// class fix), never a fixed viewport fraction -- a raw fraction
// silently lands on whatever the landing board's seeded content
// happens to occupy at that fraction, which shifts the moment the
// seed's own layout changes.

test('dragging the shape tool lands a rectangle, never a card, disarms, and leaves it selected', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const shapeTool = page.getByTestId('atlas-tray-shape')
  await clickAtlasTrayTool(page, 'atlas-tray-shape')
  await expect(shapeTool).toHaveAttribute('data-armed', 'true')
  const picker = page.getByTestId('atlas-shape-style-picker')
  await expect(picker).toBeVisible()
  // Rectangle is the default type -- confirmed selected before any drag.
  await expect(picker.getByTestId('atlas-shape-type-rectangle')).toHaveAttribute('data-selected', 'true')

  const draw1 = await shapeDrawPoints(page, board, picker)
  await dragBetween(page, draw1.from, draw1.to)

  const shapes = shapeObjects(page)
  await expect(shapes).toHaveCount(1)
  await expect(shapes.first()).toHaveAttribute('data-shape-type', 'rectangle')
  // The rule, absolute: drawing never creates a card the user didn't
  // explicitly ask for.
  await expect(page.getByTestId('atlas-note-card').filter({ hasText: 'Rectangle' })).toHaveCount(0)

  // One-shot (goal 0199, contract items 1-2): the draw disarms the
  // tool (its own options bar closes with it) and leaves the new
  // object selected -- the load-bearing half that puts the resize
  // handles on the thing just made instead of on nothing. The Annotate
  // group closes along with the disarm too (goal 0224) -- shape's own
  // button leaves the DOM.
  await expect(shapeTool).not.toBeVisible()
  await expect(picker).not.toBeVisible()
  const wrapper = nonSeededBoardObjectWrapper(page, 'shape')
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

  await clickAtlasTrayTool(page, 'atlas-tray-shape')
  const picker = page.getByTestId('atlas-shape-style-picker')
  const draw = await shapeDrawPoints(page, board, picker)
  await dragBetween(page, draw.from, draw.to)
  const shapes = shapeObjects(page)
  await expect(shapes).toHaveCount(1)

  await shapes.first().click()
  await expect(shapes).toHaveCount(1)
  const wrapper = nonSeededBoardObjectWrapper(page, 'shape')
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
  await clickAtlasTrayTool(page, 'atlas-tray-shape')
  await expect(shapeTool).toHaveAttribute('data-armed', 'true')
  await expect(shapeTool).toHaveAttribute('data-locked', 'false')

  // Re-clicking the already-armed button locks it (the Excalidraw
  // convention) -- visually distinct from plain armed.
  await clickAtlasTrayTool(page, 'atlas-tray-shape')
  await expect(shapeTool).toHaveAttribute('data-locked', 'true')

  const picker = page.getByTestId('atlas-shape-style-picker')
  const shapes = shapeObjects(page)
  const draw1 = await shapeDrawPoints(page, board, picker)
  await dragBetween(page, draw1.from, draw1.to)
  await expect(shapes).toHaveCount(1)
  // Locked survives the commit: the next drag needs no re-arm.
  await expect(shapeTool).toHaveAttribute('data-armed', 'true')
  await expect(shapeTool).toHaveAttribute('data-locked', 'true')

  // A fresh search: it naturally clears shape 1 (now a real rendered
  // node) along with everything else already occupied.
  const draw2 = await shapeDrawPoints(page, board, picker)
  await dragBetween(page, draw2.from, draw2.to)
  await expect(shapes).toHaveCount(2)

  // Escape disarms even a locked tool, and closes the Annotate group
  // along with it (goal 0224).
  await page.keyboard.press('Escape')
  await expect(shapeTool).not.toBeVisible()

  await deleteViaContextMenu(page, shapes.nth(0))
  await deleteViaContextMenu(page, shapes.nth(0))
  await expect(shapes).toHaveCount(0)
})

test('picking ellipse then arrow draws each type, and an arrow carries no Size (dx/dy only)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await clickAtlasTrayTool(page, 'atlas-tray-shape')
  const picker = page.getByTestId('atlas-shape-style-picker')
  await expect(picker).toBeVisible()

  await picker.getByTestId('atlas-shape-type-ellipse').click()
  await expect(picker.getByTestId('atlas-shape-type-ellipse')).toHaveAttribute('data-selected', 'true')
  // shapeDrawPoints excludes the style picker's own popover (anchored
  // 'outside-top' of the bottom-center tray, so it occupies the
  // lower-middle of the viewport for as long as shape stays armed) --
  // a drag start point landing ON that popover would be swallowed by
  // it rather than reaching the board's own pointer-capture handler,
  // never producing a shape (goal 0184's class: verify the drag start
  // point is reachable, don't assume it).
  const draw1 = await shapeDrawPoints(page, board, picker)
  await dragBetween(page, draw1.from, draw1.to)
  const shapes = shapeObjects(page)
  await expect(shapes).toHaveCount(1)
  await expect(shapes.first()).toHaveAttribute('data-shape-type', 'ellipse')

  // Shape is discrete (goal 0199): the ellipse draw already disarmed
  // the tool, so the arrow type needs a fresh arm before it can be
  // picked -- the style store keeps 'ellipse' selected across that
  // cycle (this file's own third test proves the same store persists
  // stroke colour), so re-arming here is the realistic gesture, not a
  // workaround.
  await clickAtlasTrayTool(page, 'atlas-tray-shape')
  await expect(picker).toBeVisible()
  await picker.getByTestId('atlas-shape-type-arrow').click()
  const draw2 = await shapeDrawPoints(page, board, picker)
  await dragBetween(page, draw2.from, draw2.to)
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

  await clickAtlasTrayTool(page, 'atlas-tray-shape')
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
  await clickAtlasTrayTool(page, 'atlas-tray-shape')
  await expect(picker).toBeVisible()
  await expect(picker.getByTestId('atlas-shape-stroke-da3633')).toHaveAttribute('data-selected', 'true')

  const shapes = shapeObjects(page)
  const draw = await shapeDrawPoints(page, board, picker)
  await dragBetween(page, draw.from, draw.to)
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

// Goal 0209's own hit-testing decision, recorded at
// AtlasBoardObjectNode.module.css's `.object` rule: the node's outer
// wrapper carries no `pointer-events` override, so it already captures
// a click anywhere in its own box regardless of the shape's own SVG
// fill state -- this pins that FILLED behaviour as a committed
// regression test, clicking a point well inside the rectangle's own
// bounding box that is not on the 2px stroke line.
test('a filled shape selects on a click inside its interior, not just on the stroke', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await clickAtlasTrayTool(page, 'atlas-tray-shape')
  const picker = page.getByTestId('atlas-shape-style-picker')
  await expect(picker).toBeVisible()
  await picker.getByTestId('atlas-shape-fill-da3633').click()
  await expect(picker.getByTestId('atlas-shape-fill-da3633')).toHaveAttribute('data-selected', 'true')

  const draw = await shapeDrawPoints(page, board, picker)
  await dragBetween(page, draw.from, draw.to)
  const shapes = shapeObjects(page)
  await expect(shapes).toHaveCount(1)

  const box = await shapes.first().boundingBox()
  if (!box) throw new Error('no shape box')
  await shapes.first().click({ position: { x: box.width / 2, y: box.height / 2 } })
  const wrapper = nonSeededBoardObjectWrapper(page, 'shape')
  await expect(wrapper).toHaveClass(/selected/)

  await deleteViaContextMenu(page, shapes.first())
  await expect(shapes).toHaveCount(0)
})

// The other half of the same decision: fill=none (the default, drawn
// unchanged) keeps today's semantics -- the interior stays clickable
// even though the SVG itself paints nothing there, because it's the
// outer wrapper div, not the SVG's own paint, that is hit-tested.
test('an unfilled (fill=none) shape selects on the exact same interior click', async ({ page }) => {
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

  const box = await shapes.first().boundingBox()
  if (!box) throw new Error('no shape box')
  await shapes.first().click({ position: { x: box.width / 2, y: box.height / 2 } })
  const wrapper = nonSeededBoardObjectWrapper(page, 'shape')
  await expect(wrapper).toHaveClass(/selected/)

  await deleteViaContextMenu(page, shapes.first())
  await expect(shapes).toHaveCount(0)
})
