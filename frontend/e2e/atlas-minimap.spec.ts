import { test, expect } from './fixtures/server'

// The board's own minimap (goal 0106 slice B contract item 5): React
// Flow's own MiniMap, styled to tokens (ThemedMiniMap.tsx), a
// control-strip toggle button alongside zoom, a palette command, and
// localStorage persistence (default ON) -- each browser context here
// starts with fresh storage (Playwright's own default per-test
// isolation), so every test below reads the untouched default.

test('the minimap renders by default, bottom-right of the board, in the same control cluster as zoom', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await expect(board.locator('.react-flow__minimap')).toBeVisible()
  const toggle = board.getByTestId('atlas-minimap-toggle')
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  // Same cluster as the zoom/fit-view/lock buttons, not a separate
  // panel -- `has` must be built off `page`, not a locator already
  // scoped through a separate ancestor (`board`), or the filter never
  // matches.
  await expect(page.locator('.react-flow__controls').filter({ has: page.getByTestId('atlas-minimap-toggle') })).toHaveCount(1)
  await expect(board.locator('.react-flow__controls-zoomin')).toBeVisible()
})

test('the toggle button hides and shows the minimap, and the choice persists across a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const toggle = board.getByTestId('atlas-minimap-toggle')
  await toggle.click()
  await expect(board.locator('.react-flow__minimap')).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')

  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(board).toBeVisible()
  await expect(board.locator('.react-flow__minimap')).toHaveCount(0)
  await expect(board.getByTestId('atlas-minimap-toggle')).toHaveAttribute('aria-pressed', 'false')
})

test('the "Toggle minimap" palette command flips the same toggle the button does', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await expect(board.locator('.react-flow__minimap')).toBeVisible()

  await page.keyboard.press('Meta+/')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox').fill('Toggle minimap')
  await palette.getByRole('option', { name: 'Toggle minimap' }).click()
  await expect(palette).toHaveCount(0)

  await expect(board.locator('.react-flow__minimap')).toHaveCount(0)
  await expect(board.getByTestId('atlas-minimap-toggle')).toHaveAttribute('aria-pressed', 'false')
})
