import { test, expect } from './fixtures/server'
import { openToolbarAction } from './fixtures/toolbarActions'
import { placeNoteClear } from './fixtures/atlasEmptyRegion'
import { findEmptyBoardRect } from './fixtures/atlasEmptyRegion'
import { paletteDialog } from './fixtures/palette'

// The board's Contents dialog (docs/goals/0279): everything on the
// board listed by kind with display names -- the user half of "how do
// you get a list of notes?". Shared pool: the one note this spec
// creates is deleted before it ends.

async function openAtlas(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  return board
}

test('Contents lists the seeded cards under Card, a placed note under Note by its first line, filters by name, and jumps on activation', async ({ page }) => {
  const board = await openAtlas(page)

  // Toolbar door.
  await openToolbarAction(page, 'atlas-open-contents')
  const dialog = page.locator('[data-component="atlas-contents-dialog"]')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('atlas-contents-filter').locator('input')).toBeFocused()
  const cards = dialog.getByTestId('atlas-contents-group-card')
  await expect(cards.getByRole('heading')).toContainText('Card ·')
  // Rows filed under a card carry its title in their description, so
  // the card's OWN row is addressed by its title attribute.
  await expect(cards.locator('[data-testid="atlas-contents-row"][data-title="The engagement"]')).toBeVisible()
  await expect(dialog.getByTestId('atlas-contents-group-note')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // A note placed on the board lists under Note by its first line.
  await placeNoteClear(page, board)
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('contenteditable') === 'true'))
    .toBe(true)
  // Still one atomic insert (goal 0296 S2b): with the focus-loop caret
  // reset fixed, this exact flow -- a dialog closed by Escape right
  // before the note -- still loses the first word 1 in 3 under
  // E2E_CPU_THROTTLE=4 with no focus change and no doc shrink caught at
  // the engine's updateState; the residual mechanism is the goal's
  // open item, and this line is its marker.
  // Per keystroke on purpose: the note's first characters are exactly
  // what goal 0296 S2b protects.
  await page.keyboard.type('Contents probe note')
  await page.keyboard.press('Enter')
  await page.keyboard.type('second line')
  const bb = await board.boundingBox()
  if (!bb) throw new Error('board has no bounding box')
  const blur = await findEmptyBoardRect(page, board, 120, 80)
  await board.click({ position: { x: blur.x - bb.x + 5, y: blur.y - bb.y + 5 } })
  const sticky = page.getByTestId('atlas-sticky-note')
  await expect(sticky).toBeVisible()

  // Palette door opens the same dialog.
  await page.keyboard.press('Meta+/')
  await expect(paletteDialog(page)).toBeVisible()
  await paletteDialog(page).getByRole('combobox').fill('Contents')
  await paletteDialog(page).getByRole('option', { name: 'Contents', exact: true }).click()
  await expect(dialog).toBeVisible()
  const noteRow = dialog.getByTestId('atlas-contents-group-note').locator('[data-testid="atlas-contents-row"][data-title="Contents probe note"]')
  // The note's save lands a beat after the blur; the dialog refetches
  // on that atlas dataevent, so the row appears within this window.
  await expect(noteRow).toBeVisible({ timeout: 10_000 })

  // Filtering narrows every group; an impossible filter says so.
  await dialog.getByTestId('atlas-contents-filter').locator('input').fill('probe note')
  await expect(dialog.getByTestId('atlas-contents-group-card')).toHaveCount(0)
  await expect(noteRow).toBeVisible()
  await dialog.getByTestId('atlas-contents-filter').locator('input').fill('zzz-nothing-matches')
  await expect(dialog.getByTestId('atlas-contents-empty')).toHaveText('Nothing matches.')
  await dialog.getByTestId('atlas-contents-filter').locator('input').fill('probe')

  // Activating the note row closes the dialog and brings the note into
  // view on the board.
  await noteRow.click()
  await expect(dialog).toHaveCount(0)
  await expect(sticky).toBeInViewport()

  // Cleanup: the note.
  await sticky.click()
  await page.keyboard.press('Delete')
  await expect(sticky).toHaveCount(0)
})
