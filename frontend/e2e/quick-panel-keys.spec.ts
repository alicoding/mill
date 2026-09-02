import { test, expect } from './fixtures/server'

// Quick Panel keyboard navigation (goal 0294). Shared worker pool: every
// assertion is about the panel's own list at rest over the seeded
// workflows, nothing is created or deleted.

// Regression (goal 0294): the row-tracking callback handed to the list
// must keep a stable identity, or the list rebuilds its focus zone on
// every render and Down never leaves the first row.
test('arrow keys walk the rows while the search keeps focus', async ({ page }) => {
  await page.goto('about:blank')
  await page.goto('/#/quickpanel')
  const search = page.getByRole('combobox', { name: 'Quick Panel search' })
  await expect(search).toBeFocused()
  const activeRowText = () => page.evaluate(() => {
    const id = document.activeElement?.getAttribute('aria-activedescendant')
    return id ? document.getElementById(id)?.textContent ?? '' : ''
  })
  const first = await activeRowText()
  expect(first).not.toBe('')
  await page.keyboard.press('ArrowDown')
  await expect.poll(activeRowText).not.toBe(first)
  const second = await activeRowText()
  await page.keyboard.press('ArrowDown')
  await expect.poll(activeRowText).not.toBe(second)
  await expect(search).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect.poll(activeRowText).toBe(second)
})

