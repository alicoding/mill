import { expect as baseExpect, test as pluginTest } from '@playwright/test'
import { test, expect } from './fixtures/server'
import { launchWithPlugins, runFromPalette } from './fixtures/runtimePlugins'
import { findEmptyBoardRect } from './fixtures/atlasEmptyRegion'
import { openSettings } from './fixtures/settingsNav'

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

test('Settings offers a color scheme per mode, and picking Dimmed repaints', async ({ page }) => {
  await page.goto('/')
  await openSettings(page, 'appearance')
  await expect(page.getByTestId('settings-view')).toBeVisible()

  const light = page.getByTestId('light-scheme-select')
  const dark = page.getByTestId('dark-scheme-select')
  await expect(light).toBeVisible()
  await expect(dark).toBeVisible()
  // Primer's schemes under Mill's copy, in the listed order.
  await expect(light.locator('option')).toHaveText([
    'Default', 'High contrast', 'Colorblind', 'Colorblind high contrast', 'Tritanopia', 'Tritanopia high contrast',
  ])
  await expect(dark.locator('option')).toHaveText([
    'Default', 'Dimmed', 'High contrast', 'Colorblind', 'Colorblind high contrast', 'Tritanopia', 'Tritanopia high contrast',
  ])

  await page.getByRole('button', { name: 'Dark theme' }).click()
  await expect.poll(() => htmlAttr(page, 'data-color-mode')).toBe('dark')
  const plainDark = await bgDefault(page)
  expect(plainDark).not.toBe('')

  await dark.selectOption('dark_dimmed')
  await expect.poll(() => htmlAttr(page, 'data-dark-theme')).toBe('dark_dimmed')
  await expect.poll(() => htmlAttr(page, 'data-mill-scheme')).toBe('dark_dimmed')
  // A different scheme is a different palette, not just a different
  // attribute -- the page background itself moves.
  await expect.poll(() => bgDefault(page)).not.toBe(plainDark)
})

test('a theme change reaches an already-open second window without a reload', async ({ page, context }) => {
  await page.goto('/')
  const panel = await context.newPage()
  await panel.goto('/#/quickpanel')
  await expect.poll(() => htmlAttr(panel, 'data-color-mode')).toBe('auto')

  await openSettings(page, 'appearance')
  await expect(page.getByTestId('settings-view')).toBeVisible()
  await page.getByRole('button', { name: 'Dark theme' }).click()

  // The Quick Panel window follows -- never reloaded here, so a stale
  // first-paint seed would fail this.
  await expect.poll(() => htmlAttr(panel, 'data-color-mode')).toBe('dark')
  await expect.poll(() => htmlAttr(panel, 'data-mill-theme')).toBe('dark')

  await page.getByTestId('dark-scheme-select').selectOption('dark_high_contrast')
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
    await page.locator('[data-testid="atlas-creation-tray"] button[aria-label="Bookmark"]').click()
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
    await settings.getByRole('button', { name: 'Dark theme' }).click()
    await settings.getByTestId('dark-scheme-select').selectOption('dark_dimmed')

    await baseExpect(face).toHaveAttribute('data-mill-theme', 'dark')
    await baseExpect(face).toHaveAttribute('data-mill-scheme', 'dark_dimmed')

    // The Request tester example's own view root carries the same pair;
    // its styling passes the theme conformance check (the Go suite runs
    // that over every shipped example).
    await runFromPalette(page, 'Request tester')
    const view = page.getByTestId('plugin-view-mill-request-tester-tester')
    await baseExpect(view).toBeVisible()
    await baseExpect(view).toHaveAttribute('data-mill-theme', 'dark')

    await settings.close()
  } finally {
    await close()
  }
})
