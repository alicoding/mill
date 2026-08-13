import { test, expect } from './fixtures/server'

// Design-wave-1 fix #3: three dark-mode bugs caught in the full-app
// design audit (screenshots: canvas-*-dark.png showed a light-hardcoded
// MiniMap, settings-mid-dark.png showed a white "Away after" number
// input). This spec proves the fix over the REAL Settings dark-theme
// toggle (SegmentedControl, SettingsView.tsx) rather than emulating
// prefers-color-scheme -- Primer's ThemeProvider colorMode is driven by
// that control (via useTheme()/App.tsx's data-color-mode mirroring),
// so clicking it is the same real path a user takes, not a stand-in.

function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

async function switchToDarkTheme(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByTestId('settings-view')).toBeVisible()
  await page.getByRole('button', { name: 'Dark theme' }).click()
  // Primer's ThemeProvider mirrors the resolved mode onto <html data-color-mode>
  // (App.tsx) -- wait for that instead of an arbitrary timeout.
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.colorMode)).toBe('dark')
}

test('Settings "Away after" number input is themed in dark mode, not a white box', async ({ page }) => {
  await page.goto('/')
  await switchToDarkTheme(page)

  const input = page.getByTestId('attention-idle-threshold-input')
  await expect(input).toBeVisible()
  const bg = await input.evaluate((el) => getComputedStyle(el).backgroundColor)
  // The bug was a literal white box (rgb(255, 255, 255)) regardless of
  // theme -- asserting it's no longer that exact value is the precise
  // regression check, without hardcoding the themed value itself
  // (which is free to change with the token palette).
  expect(bg).not.toBe('rgb(255, 255, 255)')
})

test('the canvas minimap is themed in dark mode, not React Flow\'s light default', async ({ page }) => {
  await page.goto('/')
  await switchToDarkTheme(page)

  await page.getByRole('link', { name: 'Workflows' }).click()
  // Same deterministic, clipboard-free seed workflow-view-mode.spec.ts's
  // own "Run works from view mode" test already opens.
  await workflowRow(page, 'Example: Branch to a decision').click()

  const minimap = activePanel(page).locator('.react-flow__minimap')
  await expect(minimap).toBeVisible()
  const bg = await minimap.evaluate((el) => getComputedStyle(el).backgroundColor)
  // React Flow's own light-default is solid white; Mill's minimap now
  // resolves `var(--bgColor-inset)` (CompositionCanvas.tsx), which is
  // dark in dark mode.
  expect(bg).not.toBe('rgb(255, 255, 255)')
})
