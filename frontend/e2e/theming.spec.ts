import { expect as baseExpect, test as pluginTest } from '@playwright/test'
import { test, expect } from './fixtures/server'
import { launchWithPlugins, runFromPalette } from './fixtures/runtimePlugins'
import { findEmptyBoardRect } from './fixtures/atlasEmptyRegion'
import { openSettings } from './fixtures/settingsNav'
import { armToolFromMorePanel } from './fixtures/atlasTray'
import { applyCpuThrottle } from './fixtures/throttle'

// Theming (goal 0320): the color scheme per mode, one theme across
// every window, and the plugin theme contract.
//
// The appearance interaction tests run on the SHARED worker pool: the
// choice lives in this browser context's own localStorage, which
// Playwright gives each test fresh. The plugin face test needs a
// plugins directory, so it takes a dedicated server (offset 70) like
// every runtime-plugin spec.

const htmlAttr = (page: import('@playwright/test').Page, name: string) =>
  page.evaluate((n) => document.documentElement.getAttribute(n), name)

const bgDefault = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bgColor-default').trim())

for (const systemAppearance of ['light', 'dark'] as const) {
  test(`an opposite-family hover previews the whole window and cancels under ${systemAppearance} system appearance`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: systemAppearance })
    await page.goto('/')
    await openSettings(page, 'appearance')
    const committed = await bgDefault(page)
    const oppositeFamily = systemAppearance === 'light' ? 'dark' : 'light'
    const firstScheme = systemAppearance === 'light' ? 'dark_dimmed' : 'light_high_contrast'
    const secondScheme = systemAppearance === 'light' ? 'dark_high_contrast' : 'light_colorblind'

    await page.getByTestId(`${oppositeFamily}-scheme-select-option-${firstScheme}`).hover()
    await expect.poll(() => htmlAttr(page, 'data-color-mode')).toBe(oppositeFamily)
    await expect.poll(() => htmlAttr(page, 'data-mill-theme')).toBe(oppositeFamily)
    await expect.poll(() => htmlAttr(page, 'data-mill-scheme')).toBe(firstScheme)
    await expect.poll(() => bgDefault(page)).not.toBe(committed)
    expect(await page.evaluate(() => localStorage.getItem('mill-color-mode'))).toBeNull()

    await page.keyboard.press('Escape')
    await expect.poll(() => htmlAttr(page, 'data-color-mode')).toBe('auto')
    await expect.poll(() => htmlAttr(page, 'data-mill-theme')).toBe(systemAppearance)
    await expect.poll(() => bgDefault(page)).toBe(committed)

    await page.getByTestId(`${oppositeFamily}-scheme-select-option-${secondScheme}`).hover()
    await expect.poll(() => htmlAttr(page, 'data-mill-scheme')).toBe(secondScheme)
    await page.getByTestId('settings-view').hover({ position: { x: 2, y: 2 } })
    await expect.poll(() => htmlAttr(page, 'data-color-mode')).toBe('auto')
    await expect.poll(() => bgDefault(page)).toBe(committed)
  })
}

test('Single theme groups both families and commits a dark choice from light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize({ width: 360, height: 720 })
  await page.goto('/#/settings/appearance')
  await expect(page.getByTestId('settings-pane-appearance')).toBeVisible()
  await page.getByTestId('theme-mode-select').selectOption('single')

  const themes = page.getByTestId('single-theme-select')
  await expect(themes).toBeVisible()
  await expect(themes.getByText('Light themes', { exact: true })).toBeVisible()
  await expect(themes.getByText('Dark themes', { exact: true })).toBeVisible()
  await expect(themes.getByRole('option', { name: 'Light Default' })).toHaveAttribute('aria-selected', 'true')
  await expect(themes.getByRole('option', { name: 'Dark Default' })).toHaveAttribute('aria-selected', 'false')
  const lightPreference = await page.evaluate(() => localStorage.getItem('mill-light-scheme'))
  const lightBackground = await bgDefault(page)

  await page.getByTestId('single-theme-select-option-dark_dimmed').click()
  await expect.poll(() => htmlAttr(page, 'data-color-mode')).toBe('dark')
  await expect.poll(() => htmlAttr(page, 'data-mill-theme')).toBe('dark')
  await expect.poll(() => htmlAttr(page, 'data-mill-scheme')).toBe('dark_dimmed')
  await expect.poll(() => bgDefault(page)).not.toBe(lightBackground)
  expect(await page.evaluate(() => localStorage.getItem('mill-light-scheme'))).toBe(lightPreference)
  expect(await page.evaluate(() => localStorage.getItem('mill-dark-scheme'))).toBe('dark_dimmed')
  expect(await page.evaluate(() => localStorage.getItem('mill-color-mode'))).toBe('dark')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

  await page.reload()
  await expect(page.getByTestId('theme-mode-select')).toHaveValue('single')
  await expect.poll(() => htmlAttr(page, 'data-mill-scheme')).toBe('dark_dimmed')
  await expect(page.getByRole('option', { name: 'Dark Dimmed' })).toHaveAttribute('aria-selected', 'true')
})

test('keyboard focus previews across families, and cancel or focus exit restores the committed theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await openSettings(page, 'appearance')
  await page.getByTestId('theme-mode-select').selectOption('single')
  const selected = page.getByRole('option', { name: 'Light Default' })

  await selected.click()
  await page.keyboard.press('End')
  await expect(page.getByRole('option', { name: 'Dark Tritanopia high contrast' })).toBeFocused()
  await expect.poll(() => htmlAttr(page, 'data-mill-theme')).toBe('dark')
  await page.keyboard.press('Escape')
  await expect.poll(() => htmlAttr(page, 'data-mill-theme')).toBe('light')
  await expect(page.getByRole('option', { name: 'Dark Tritanopia high contrast' })).toBeFocused()

  await page.keyboard.press('ArrowUp')
  await expect.poll(() => htmlAttr(page, 'data-mill-theme')).toBe('dark')
  await page.keyboard.press('Tab')
  await expect.poll(() => htmlAttr(page, 'data-mill-theme')).toBe('light')

  await selected.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Space')
  await expect.poll(() => htmlAttr(page, 'data-color-mode')).toBe('dark')
  await expect.poll(() => htmlAttr(page, 'data-mill-scheme')).toBe('dark_tritanopia_high_contrast')
  expect(await page.evaluate(() => localStorage.getItem('mill-color-mode'))).toBe('dark')

  const committed = page.getByRole('option', { name: 'Dark Tritanopia high contrast' })
  await committed.click()
  await page.keyboard.press('Home')
  await expect(page.getByRole('option', { name: 'Light Default' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect.poll(() => htmlAttr(page, 'data-color-mode')).toBe('light')
  await expect.poll(() => htmlAttr(page, 'data-mill-scheme')).toBe('light')
})

test('Follow system saves both preferences, while mode transitions preserve them and follow the OS', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await openSettings(page, 'appearance')
  await page.getByTestId('dark-scheme-select-option-dark_dimmed').click()
  await page.getByTestId('light-scheme-select-option-light_high_contrast').click()
  expect(await page.evaluate(() => localStorage.getItem('mill-color-mode'))).toBe('auto')
  expect(await page.evaluate(() => localStorage.getItem('mill-light-scheme'))).toBe('light_high_contrast')
  expect(await page.evaluate(() => localStorage.getItem('mill-dark-scheme'))).toBe('dark_dimmed')
  await expect.poll(() => htmlAttr(page, 'data-mill-scheme')).toBe('dark_dimmed')

  await page.getByTestId('theme-mode-select').selectOption('single')
  await expect.poll(() => htmlAttr(page, 'data-color-mode')).toBe('dark')
  await expect.poll(() => htmlAttr(page, 'data-mill-scheme')).toBe('dark_dimmed')
  await page.getByTestId('theme-mode-select').selectOption('auto')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => htmlAttr(page, 'data-color-mode')).toBe('auto')
  await expect.poll(() => htmlAttr(page, 'data-mill-scheme')).toBe('light_high_contrast')
  expect(await page.evaluate(() => localStorage.getItem('mill-dark-scheme'))).toBe('dark_dimmed')
})

test('preview stays in one window, then a Single theme commit reaches the already-open second window', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  const panel = await context.newPage()
  await panel.emulateMedia({ colorScheme: 'light' })
  await panel.goto('/#/quickpanel')
  await expect.poll(() => htmlAttr(panel, 'data-color-mode')).toBe('auto')
  const panelBackground = await bgDefault(panel)

  await openSettings(page, 'appearance')
  await page.getByTestId('dark-scheme-select-option-dark_dimmed').hover()
  await expect.poll(() => htmlAttr(page, 'data-mill-theme')).toBe('dark')
  await expect.poll(() => htmlAttr(panel, 'data-color-mode')).toBe('auto')
  await expect.poll(() => htmlAttr(panel, 'data-mill-theme')).toBe('light')
  expect(await bgDefault(panel)).toBe(panelBackground)

  await page.keyboard.press('Escape')
  await page.getByTestId('theme-mode-select').selectOption('single')
  await page.getByTestId('single-theme-select-option-dark_dimmed').click()
  await expect.poll(() => htmlAttr(panel, 'data-color-mode')).toBe('dark')
  await expect.poll(() => htmlAttr(panel, 'data-mill-theme')).toBe('dark')
  await expect.poll(() => htmlAttr(panel, 'data-mill-scheme')).toBe('dark_dimmed')
  await panel.close()
})

test('navigation clears preview to the latest system and remote committed appearance', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await openSettings(page, 'appearance')
  await page.getByTestId('dark-scheme-select-option-dark_high_contrast').hover()
  await expect.poll(() => htmlAttr(page, 'data-mill-scheme')).toBe('dark_high_contrast')

  const updater = await context.newPage()
  await updater.goto('/')
  await openSettings(updater, 'appearance')
  await updater.getByTestId('dark-scheme-select-option-dark_dimmed').click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mill-dark-scheme'))).toBe('dark_dimmed')

  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => htmlAttr(page, 'data-mill-scheme')).toBe('dark_high_contrast')
  await page.getByTestId('settings-group-item-backups').click()
  await expect(page.getByTestId('settings-pane-backups')).toBeVisible()
  await expect.poll(() => htmlAttr(page, 'data-color-mode')).toBe('auto')
  await expect.poll(() => htmlAttr(page, 'data-mill-theme')).toBe('dark')
  await expect.poll(() => htmlAttr(page, 'data-mill-scheme')).toBe('dark_dimmed')
  await updater.close()
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
    await applyCpuThrottle(settings)
    await settings.goto('/')
    await openSettings(settings, 'appearance')
    await settings.getByTestId('theme-mode-select').selectOption('single')
    await settings.getByTestId('single-theme-select-option-dark_dimmed').click()

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
    const sepia = settings.getByTestId('single-theme-select-option-mill-scribble.sepia')
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
