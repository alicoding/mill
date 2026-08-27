import { test, expect } from './fixtures/server'
import { dragBetween, nonSeededBoardObjects, nonSeededBoardObjectWrapper } from './fixtures/atlasBoard'

// Shared pool (testing.md): every assertion is scoped to a shape this
// spec creates and deletes itself, or reads a seeded card's own
// computed style without mutating it.
//
// Regression (goal 0197): the selection ring was invisible on every
// board-local object (image/ink/shape) -- React Flow's own
// `.react-flow__node.selectable:focus { outline: none }` reset wins,
// at higher specificity, against a single-type `.selected` rule that
// styles the ring via `outline`, so the ring vanished the instant a
// real select click gave the wrapper DOM focus. box-shadow (what
// AtlasBoard.module.css's shared rule now uses) never collides with
// that reset -- a different CSS property entirely.
test('a selected board object and a selected card each carry a real box-shadow ring', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await page.getByTestId('atlas-tray-shape').click()
  const box = await board.boundingBox()
  if (!box) throw new Error('board has no bounding box')
  // Same top-left band atlas-shape-tool.spec.ts's own tests use --
  // clear of the seeded "Board gallery" card (goal 0223), which widens
  // this board's own fitView content extent enough to shift where a
  // more central/right-leaning percentage point lands.
  await dragBetween(
    page,
    { locator: board, position: { x: box.width * 0.05, y: box.height * 0.1 } },
    { locator: board, position: { x: box.width * 0.2, y: box.height * 0.25 } },
  )

  const shape = nonSeededBoardObjects(page, 'shape')
  await expect(shape).toHaveCount(1)
  // The shape tool is discrete (goal 0199): the draw itself disarms
  // the tool and leaves the new object selected, so the ring this
  // test is proving is already up -- no extra click needed to
  // reproduce it. A rectangle/ellipse shape's own ring lives on its
  // OWN box, not React Flow's axis-aligned wrapper (goal 0236: the
  // ring must share whatever rotation transform the shape carries),
  // so the wrapper still carries the `selected` class but its own
  // box-shadow is deliberately suppressed for this Kind.
  const shapeWrapper = nonSeededBoardObjectWrapper(page, 'shape')
  await expect(shapeWrapper).toHaveClass(/selected/)
  await expect.poll(() => shape.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')

  // A seeded card's own ring, read-only (never modified/deleted) --
  // covers the note/sticky/region-chip/group family, which already
  // rendered correctly (box-shadow, not outline) and is unaffected by
  // this fix; asserted here so the acceptance line covering "card" has
  // a direct, permanent check alongside the object-node regression.
  const seededCard = page.locator('[data-testid="rf__node-atlas-card-example-contact"]')
  await seededCard.click()
  await expect(seededCard).toHaveClass(/selected/)
  await expect.poll(() => seededCard.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')

  // Cleanup (testing.md's within-file discipline) -- deselect the
  // seeded card, delete the shape this spec created.
  await board.click({ position: { x: 10, y: 10 } })
  await shape.click({ button: 'right' })
  await page.getByText('Delete', { exact: true }).click()
  await expect(shape).toHaveCount(0)
})
