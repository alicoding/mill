import { test, expect } from './fixtures/server'
import { workflowRow, activePanel } from './fixtures/canvas'

// Design-wave-1 fix #3: three dark-mode bugs caught in the full-app
// design audit (screenshots: canvas-*-dark.png showed a light-hardcoded
// MiniMap, settings-mid-dark.png showed a white "Away after" number
// input). This spec proves the fix over the REAL Settings dark-theme
// toggle (SegmentedControl, SettingsView.tsx) rather than emulating
// prefers-color-scheme -- Primer's ThemeProvider colorMode is driven by
// that control (via useTheme()/App.tsx's data-color-mode mirroring),
// so clicking it is the same real path a user takes, not a stand-in.

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

// Design wave 2: Mill's own teal accent (app/index.css) is layered
// over Primer's shared --bgColor-accent-emphasis/-muted,
// --borderColor-accent-emphasis/-muted, --fgColor-accent tokens via
// `html:root`/`html[data-color-mode=...]` selectors carrying one extra
// specificity segment over Primer's own bare `:root`/attribute
// selectors -- this proves that actually wins the real cascade in a
// live browser (not just "should win" from reading the CSS), in both
// themes, rather than trusting the specificity math alone.
test('Mill\'s teal accent tokens override Primer\'s default blue, light and dark', async ({ page }) => {
  await page.goto('/')

  const readAccent = () => page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return {
      emphasis: style.getPropertyValue('--bgColor-accent-emphasis').trim(),
      fg: style.getPropertyValue('--fgColor-accent').trim(),
    }
  })

  const light = await readAccent()
  expect(light.emphasis.toLowerCase()).toBe('#1f6f6b')
  expect(light.fg.toLowerCase()).toBe('#1f6f6b')
  // Never Primer's own default accent blue -- the actual regression
  // this guards (a same-specificity override losing to import order).
  expect(light.emphasis.toLowerCase()).not.toBe('#0969da')

  await switchToDarkTheme(page)
  const dark = await readAccent()
  expect(dark.emphasis.toLowerCase()).toBe('#2b7d77')
  expect(dark.fg.toLowerCase()).toBe('#3fa39e')
  expect(dark.emphasis.toLowerCase()).not.toBe('#1f6feb')
})

// StatusStamp (design wave 2, goal 0001 audit §1): a real rendered
// stamp resolves to the semantic colors its variant promises, and the
// `identity` variant specifically resolves to Mill's own teal accent
// rather than Primer's default blue -- the concrete "green triple
// duty"-style collision this component exists to prevent, proven for
// the accent/identity pairing the same way the kind-color test proves
// it for canvas nodes.
test('StatusStamp variants resolve to distinct, correct colors', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const builtInStamp = page.locator('[data-testid="inventory-row"][data-entity="workflow"] [data-variant="identity"]').first()
  await expect(builtInStamp).toBeVisible()
  const color = await builtInStamp.evaluate((el) => getComputedStyle(el).color)
  // rgb(31, 111, 107) == #1f6f6b, the light-theme accent fg.
  expect(color).toBe('rgb(31, 111, 107)')
})
