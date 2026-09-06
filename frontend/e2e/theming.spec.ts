import { expect as baseExpect, test as pluginTest } from '@playwright/test'
import { test, expect } from './fixtures/server'
import { launchWithPlugins, runFromPalette } from './fixtures/runtimePlugins'
import { findEmptyBoardRect } from './fixtures/atlasEmptyRegion'
import { openSettings } from './fixtures/settingsNav'
import { armToolFromMorePanel } from './fixtures/atlasTray'

// Theming (goal 0320): the color scheme per mode, one theme across
// every window, and the plugin theme contract.
//
// The first two run on the SHARED worker pool: the appearance choice
// lives in this browser context's own localStorage, which Playwright
// gives each test fresh, so nothing here reads or writes state another
// test can see. The plugin face test needs a plugins directory, so it
// takes a dedicated server (offset 70) like every runtime-plugin spec.

const htmlAttr = (page: import('@playwright/test').Page, name: string) =>
  page.evaluate((n) => document.documentElement.getAttribute(n), name)

const bgDefault = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bgColor-default').trim())

test('the theme pickers follow the mode, and picking Dimmed repaints', async ({ page }) => {
  await page.goto('/')
  await openSettings(page, 'appearance')
  await expect(page.getByTestId('settings-view')).toBeVisible()

  const light = page.getByTestId('light-scheme-select')
  const dark = page.getByTestId('dark-scheme-select')
  // Match system is the default mode, so BOTH families are in play and
  // both are listed, each captioned with when it applies.
  await expect(light).toBeVisible()
  await expect(dark).toBeVisible()
  await expect(page.getByText('Used when the system is in light mode.')).toBeVisible()
  await expect(page.getByText('Used when the system is in dark mode.')).toBeVisible()
  // Primer's schemes under Mill's copy, in the listed order.
  await expect(light.getByRole('option')).toHaveText([
    'Default', 'High contrast', 'Colorblind', 'Colorblind high contrast', 'Tritanopia', 'Tritanopia high contrast',
  ])

  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect.poll(() => htmlAttr(page, 'data-color-mode')).toBe('dark')
  // Under a fixed mode only that family's list remains: the other one
  // could not affect this window, so it is not on screen.
  await expect(dark).toBeVisible()
  await expect(light).toHaveCount(0)
  await expect(dark.getByRole('option')).toHaveText([
    'Default', 'Dimmed', 'High contrast', 'Colorblind', 'Colorblind high contrast', 'Tritanopia', 'Tritanopia high contrast',
  ])
  const plainDark = await bgDefault(page)
  expect(plainDark).not.toBe('')

  await page.getByTestId('dark-scheme-select-option-dark_dimmed').click()
  await expect.poll(() => htmlAttr(page, 'data-dark-theme')).toBe('dark_dimmed')
  await expect.poll(() => htmlAttr(page, 'data-mill-scheme')).toBe('dark_dimmed')
  // A different scheme is a different palette, not just a different
  // attribute -- the page background itself moves.
  await expect.poll(() => bgDefault(page)).not.toBe(plainDark)
})

test('pointing at a theme previews it, and leaving the list puts the old one back', async ({ page }) => {
  await page.goto('/')
  await openSettings(page, 'appearance')
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect.poll(() => htmlAttr(page, 'data-color-mode')).toBe('dark')
  const committed = await bgDefault(page)

  await page.getByTestId('dark-scheme-select-option-dark_high_contrast').hover()
  await expect.poll(() => bgDefault(page)).not.toBe(committed)
  // A preview is not a choice: it repaints this window and writes
  // nothing, so the stored scheme has not moved.
  expect(await page.evaluate(() => localStorage.getItem('mill-dark-scheme'))).toBe('dark')

  await page.keyboard.press('Escape')
  await expect.poll(() => bgDefault(page)).toBe(committed)

  // A different item, because the pointer never left the first one:
  // preview follows the pointer entering a row, and Escape above did
  // not move it.
  await page.getByTestId('dark-scheme-select-option-dark_dimmed').hover()
  await expect.poll(() => bgDefault(page)).not.toBe(committed)
  await page.getByTestId('settings-view').hover({ position: { x: 2, y: 2 } })
  await expect.poll(() => bgDefault(page)).toBe(committed)

  await page.getByTestId('dark-scheme-select-option-dark_high_contrast').click()
  await expect.poll(() => htmlAttr(page, 'data-dark-theme')).toBe('dark_high_contrast')
  await expect.poll(() => bgDefault(page)).not.toBe(committed)
})

test('a light theme picked while the window is dark applies when the mode turns light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await openSettings(page, 'appearance')
  // Match system with the system in dark: the window is dark, and the
  // light list is still there because the system can turn light.
  await expect.poll(() => htmlAttr(page, 'data-mill-theme')).toBe('dark')
  const whileDark = await bgDefault(page)

  await page.getByTestId('light-scheme-select-option-light_high_contrast').click()
  await expect.poll(() => htmlAttr(page, 'data-light-theme')).toBe('light_high_contrast')
  // Nothing repaints yet: the choice is for the other appearance.
  expect(await bgDefault(page)).toBe(whileDark)

  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await expect.poll(() => htmlAttr(page, 'data-mill-scheme')).toBe('light_high_contrast')
  await expect.poll(() => bgDefault(page)).not.toBe(whileDark)
})

test('a theme change reaches an already-open second window without a reload', async ({ page, context }) => {
  await page.goto('/')
  const panel = await context.newPage()
  await panel.goto('/#/quickpanel')
  await expect.poll(() => htmlAttr(panel, 'data-color-mode')).toBe('auto')

  await openSettings(page, 'appearance')
  await expect(page.getByTestId('settings-view')).toBeVisible()
  await page.getByRole('button', { name: 'Dark', exact: true }).click()

  // The Quick Panel window follows -- never reloaded here, so a stale
  // first-paint seed would fail this.
  await expect.poll(() => htmlAttr(panel, 'data-color-mode')).toBe('dark')
  await expect.poll(() => htmlAttr(panel, 'data-mill-theme')).toBe('dark')

  await page.getByTestId('dark-scheme-select-option-dark_high_contrast').click()
  await expect.poll(() => htmlAttr(panel, 'data-dark-theme')).toBe('dark_high_contrast')
  await panel.close()
})

pluginTest('a plugin face and view carry the resolved theme, and it flips with the mode', async () => {
  const { page, close } = await launchWithPlugins(70)
  try {
    await page.goto('/')
    await page.getByRole('link', { name: 'Atlas' }).click()
    const board = page.getByTestId('atlas-board')
    await baseExpect(board).toBeVisible()
    await armToolFromMorePanel(page, 'Bookmark')
    const spot = await findEmptyBoardRect(page, board, 300, 200)
    const bb = await board.boundingBox()
    if (!bb) throw new Error('board has no bounding box')
    await board.click({ position: { x: spot.x - bb.x + 10, y: spot.y - bb.y + 10 } })

    const face = page.locator('[data-testid="plugin-face-bookmark"]')
    await baseExpect(face).toHaveAttribute('data-mill-theme', 'light')
    await baseExpect(face).toHaveAttribute('data-mill-scheme', 'light')

    // Settings runs in a SECOND page of the same context, so the face
    // stays mounted -- the attribute has to change under it, not be
    // re-rendered fresh by a navigation.
    const settings = await page.context().newPage()
    await settings.goto('/')
    await openSettings(settings, 'appearance')
    await settings.getByRole('button', { name: 'Dark', exact: true }).click()
    await settings.getByTestId('dark-scheme-select-option-dark_dimmed').click()

    await baseExpect(face).toHaveAttribute('data-mill-theme', 'dark')
    await baseExpect(face).toHaveAttribute('data-mill-scheme', 'dark_dimmed')

    // The Request tester example's own view root carries the same pair;
    // its styling passes the theme conformance check (the Go suite runs
    // that over every shipped example).
    await runFromPalette(page, 'Request tester')
    const view = page.getByTestId('plugin-view-mill-request-tester-tester')
    await baseExpect(view).toBeVisible()
    await baseExpect(view).toHaveAttribute('data-mill-theme', 'dark')

    // A theme the Scribble example contributes: listed under its own
    // family with the plugin that shipped it, and painting the real
    // page once chosen.
    await settings.getByRole('button', { name: 'Light', exact: true }).click()
    const sepia = settings.getByTestId('light-scheme-select-option-mill-scribble.sepia')
    await baseExpect(sepia).toBeVisible()
    await baseExpect(sepia).toContainText('Sepia')
    await baseExpect(sepia).toContainText('From Scribble')
    await sepia.click()
    await baseExpect
      .poll(() => settings.evaluate(() => document.documentElement.getAttribute('data-light-theme')))
      .toBe('mill-scribble.sepia')
    // The token the theme file declares is what the page resolves,
    // over the built-in light palette it was layered onto.
    await baseExpect
      .poll(() => settings.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bgColor-default').trim()))
      .toBe('#f6efe2')
    // A token the file leaves alone still resolves, which is what
    // proves the built-in palette underneath it.
    await baseExpect
      .poll(() => settings.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bgColor-attention-muted').trim()))
      .not.toBe('')
    // The choice reaches the window that never opened Settings.
    await baseExpect(face).toHaveAttribute('data-mill-scheme', 'mill-scribble.sepia')

    await settings.close()
  } finally {
    await close()
  }
})
