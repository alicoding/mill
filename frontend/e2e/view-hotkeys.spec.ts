import { test, expect } from '@playwright/test'

// Real Go bindings over HTTP (Wails3 server mode), not mocks -- same
// setup as the rest of this suite. Exercises task #9's in-window Cmd+1
// through Cmd+5 view hotkeys (App.tsx), each checked against a real,
// already-existing marker unique to that view rather than a new testid
// added just for this test.

test('Cmd+1 through Cmd+5 jump to their view from anywhere else in the app', async ({ page }) => {
  await page.goto('/')

  // Start on Composition (the default landing view) and confirm each
  // hotkey lands somewhere else first, so a false positive (already
  // being on the target view) can't hide a broken hotkey.
  await expect(page.getByRole('tablist', { name: 'Workflows' })).toBeVisible()

  await page.keyboard.press('Meta+2')
  await expect(page.getByRole('tablist', { name: 'Configure' })).toBeVisible()

  await page.keyboard.press('Meta+3')
  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible()

  await page.keyboard.press('Meta+4')
  await expect(page.getByRole('heading', { name: 'Runs', level: 1 })).toBeVisible()

  await page.keyboard.press('Meta+5')
  await expect(page.getByTestId('capability-index')).toBeVisible()

  await page.keyboard.press('Meta+1')
  await expect(page.getByRole('tablist', { name: 'Workflows' })).toBeVisible()
})

test('A view hotkey works while a text field has focus, matching browser tab-switching precedent', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('new-workflow').click()
  await page.getByLabel('Label').click()

  await page.keyboard.press('Meta+3')
  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible()
})

test('Plain digit keys without Cmd do not navigate', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('tablist', { name: 'Workflows' })).toBeVisible()

  await page.keyboard.press('3')
  await expect(page.getByRole('tablist', { name: 'Workflows' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toHaveCount(0)
})
