import { test, expect } from './fixtures/server'
import { boardPoint, dragBetween, dragResizeHandle } from './fixtures/atlasBoard'

// The shape rotation handle (goal 0214), rectangle/ellipse scope only
// (arrow's own geometry IS its dx/dy payload -- a second angle
// representation would conflict, so it never gets a handle). Real
// pointer-capture drags via dragResizeHandle (the same helper the
// resize handle e2e already promoted for this exact hover-down-move-up
// shape) -- never a synthesized event, per testing.md's user-primitives
// rule. Shared pool: every entity created here is deleted here.

function parseRotationDeg(transform: string): number | null {
  const m = /rotate\(([-\d.]+)deg\)/.exec(transform)
  return m ? Number(m[1]) : null
}

test('a selected shape shows the rotate handle, dragging it rotates live, Shift snaps to 15deg, deselecting hides it, and the angle survives reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await page.getByTestId('atlas-tray-shape').click()
  await dragBetween(page, await boardPoint(board, 0.3, 0.3), await boardPoint(board, 0.45, 0.45))
  const shape = page.locator('[data-testid="atlas-board-object"][data-object-kind="shape"]')
  await expect(shape).toHaveCount(1)
  const wrapper = page.locator('.react-flow__node').filter({ has: shape })
  await expect(wrapper).toHaveClass(/selected/)

  const content = shape.locator('[data-testid="atlas-shape-content"]')
  const handle = page.getByTestId('atlas-shape-rotate-handle')

  // Discrete draw tools leave the new shape selected (goal 0199) --
  // the handle appears on that same selection, no extra click needed.
  await expect(handle).toBeVisible()
  const initialTransform = await content.evaluate((el) => (el as HTMLElement).style.transform)
  expect(parseRotationDeg(initialTransform)).toBeNull()

  // Plain drag: a real rotation applies live, before anything commits.
  await dragResizeHandle(page, handle, 80, 0, 6, async (i) => {
    if (i !== 3) return
    const mid = await content.evaluate((el) => (el as HTMLElement).style.transform)
    expect(parseRotationDeg(mid), 'the shape must already be rotating mid-drag, not only after release').not.toBeNull()
  })
  await expect.poll(async () => parseRotationDeg(await content.evaluate((el) => (el as HTMLElement).style.transform))).not.toBeNull()
  const plainDeg = parseRotationDeg(await content.evaluate((el) => (el as HTMLElement).style.transform))
  if (plainDeg === null) throw new Error('no rotation after plain drag')
  // Dragging the handle rightward from its resting spot above the
  // shape is a clockwise turn -- a positive, sub-180deg reading.
  expect(plainDeg).toBeGreaterThan(0)
  expect(plainDeg).toBeLessThan(180)
  // The rotate drag must never disturb the selection it depends on --
  // regression for the compat-click deselect this drag's own
  // preventDefault calls now suppress (the wrapper's own `selected`
  // class was confirmed lost immediately on pointerup before that fix).
  await expect(wrapper).toHaveClass(/selected/)

  // Escape mid-drag cancels back to the pre-drag angle (the plain
  // drag's own committed value), never persisting the aborted turn --
  // driven through the same checked dragResizeHandle helper, pressing
  // Escape partway through rather than letting the drag complete.
  const beforeEscapeDrag = plainDeg
  await dragResizeHandle(page, handle, -80, 0, 4, async (i) => {
    if (i !== 2) return
    await expect.poll(async () => parseRotationDeg(await content.evaluate((el) => (el as HTMLElement).style.transform))).not.toBe(beforeEscapeDrag)
    await page.keyboard.press('Escape')
  })
  await expect.poll(async () => parseRotationDeg(await content.evaluate((el) => (el as HTMLElement).style.transform))).toBe(beforeEscapeDrag)

  // Shift-held drag snaps to 15deg increments. Raw page.mouse, not
  // dragResizeHandle: that checked helper's own hover-then-press
  // leaves no room for an interleaved key hold, the same reason
  // atlas-select-group.spec.ts's own shift-drag stays on raw mouse
  // calls. Shift goes down AFTER the press, not before -- confirmed
  // live: React Flow's own selectionKeyCode is Shift by default
  // (AtlasBoard.tsx's own `anyDragToolArmed` comment names it), so
  // Shift already held AT pointerdown arms React Flow's global
  // box-select first and the press never reaches this handle's own
  // onPointerDown at all. Holding it once the drag is already running
  // reads identically to a user who starts dragging, then holds Shift
  // for precision -- and is what this handle's own pointermove check
  // actually sees.
  const handleBox = await handle.boundingBox()
  if (!handleBox) throw new Error('rotate handle has no bounding box')
  const handleCenter = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 }
  await handle.hover({ position: { x: handleBox.width / 2, y: handleBox.height / 2 } })
  // eslint-disable-next-line no-restricted-syntax -- interleaved Shift hold, see comment above
  await page.mouse.down()
  await page.keyboard.down('Shift')
  const shiftSteps = 6
  for (let i = 1; i <= shiftSteps; i++) {
    // eslint-disable-next-line no-restricted-syntax -- free-form drag path, inherently unchecked (goal 0184 RESEARCH VERDICT)
    await page.mouse.move(handleCenter.x + (-55 * i) / shiftSteps, handleCenter.y + (40 * i) / shiftSteps)
    await page.waitForTimeout(50) // matches dragResizeHandle's own per-step settle, avoiding pointermove coalescing
  }
  await page.keyboard.up('Shift')
  // eslint-disable-next-line no-restricted-syntax -- interleaved Shift hold, see comment above
  await page.mouse.up()
  await expect.poll(async () => parseRotationDeg(await content.evaluate((el) => (el as HTMLElement).style.transform))).not.toBeNull()
  const snappedDeg = parseRotationDeg(await content.evaluate((el) => (el as HTMLElement).style.transform))
  if (snappedDeg === null) throw new Error('no rotation after shift-snapped drag')
  expect(snappedDeg % 15).toBe(0)

  // Deselecting hides the handle -- it never renders during a
  // multi-selection or with nothing selected.
  await page.keyboard.press('Escape')
  await expect(wrapper).not.toHaveClass(/selected/)
  await expect(handle).not.toBeVisible()

  // The angle persists across reload.
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  const reloadedShape = page.locator('[data-testid="atlas-board-object"][data-object-kind="shape"]')
  await expect(reloadedShape).toBeVisible()
  const reloadedContent = reloadedShape.locator('[data-testid="atlas-shape-content"]')
  await expect.poll(async () => parseRotationDeg(await reloadedContent.evaluate((el) => (el as HTMLElement).style.transform))).toBe(snappedDeg)

  await reloadedShape.click({ button: 'right' })
  await page.getByText('Delete', { exact: true }).click()
  await expect(reloadedShape).toHaveCount(0)
})
