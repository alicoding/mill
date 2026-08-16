import { test, expect } from './fixtures/server'

// Real Go bindings over HTTP (Wails3 server mode), not mocks -- same
// setup as the rest of this suite. Exercises task #9's in-window Cmd+1
// through Cmd+4 view hotkeys (App.tsx), each checked against that
// view's own page-level data-testid (home-view/composition-view/
// activity-view/settings-view/review-view) rather than its h1 heading
// text -- design-wave-1 fix #6 turned each page's h1 into its own
// descriptive subtitle (no longer a fixed, short page-name string), so
// the testid is now the stable per-view marker these hotkey checks
// need. Cmd+4 lands on Review -- the in-app Spec
// view was retired (docs/SPEC.md stays the source of truth, just no
// longer rendered in-app), freeing up the slot; a durable run's own
// history/redrive already lives on that workflow's own Runs tab
// (docs/SPEC.md §7's Update), so there's no fifth top-level destination
// to bind a hotkey to. Cmd+1 through Cmd+4 still map to Workflows/
// Configure/Activity/Review exactly as before (commands.ts unchanged) --
// only the app's DEFAULT LANDING view moved, from Workflows to Home
// (docs/goals/0014-home-dashboard.md), so every test below that used to
// assume "start on Workflows" now jumps there via its own Cmd+1 first.

test('Cmd+1 through Cmd+5 jump to their view from anywhere else in the app', async ({ page }) => {
  await page.goto('/')

  // Home is the default landing view now -- confirm it, then jump to
  // Workflows via its own hotkey before exercising Cmd+2 through Cmd+5,
  // so a false positive (already being on the target view) can't hide a
  // broken hotkey.
  await expect(page.getByTestId('home-view')).toBeVisible()

  await page.keyboard.press('Meta+1')
  await expect(page.getByTestId('composition-view')).toBeVisible()

  await page.keyboard.press('Meta+2')
  await expect(page.getByRole('tablist', { name: 'Configure' })).toBeVisible()

  await page.keyboard.press('Meta+3')
  await expect(page.getByTestId('atlas-view')).toBeVisible()

  await page.keyboard.press('Meta+4')
  await expect(page.getByTestId('activity-view')).toBeVisible()

  await page.keyboard.press('Meta+5')
  await expect(page.getByTestId('review-view')).toBeVisible()

  await page.keyboard.press('Meta+1')
  await expect(page.getByTestId('composition-view')).toBeVisible()
})

test('Cmd+, opens Settings — macOS\'s universal preferences shortcut', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('home-view')).toBeVisible()

  await page.keyboard.press('Meta+,')
  await expect(page.getByTestId('settings-view')).toBeVisible()
})

test('A view hotkey works while a text field has focus, matching browser tab-switching precedent', async ({ page }) => {
  await page.goto('/')
  // Wait for the app to actually mount (and its keydown listener with
  // it) before pressing anything -- a keypress fired immediately after
  // goto(), with no intervening wait, races the page's own hydration.
  await expect(page.getByTestId('home-view')).toBeVisible()
  await page.keyboard.press('Meta+1')
  await expect(page.getByTestId('composition-view')).toBeVisible()
  await page.getByTestId('new-workflow').click()
  await page.getByLabel('Label').click()

  await page.keyboard.press('Meta+3')
  await expect(page.getByTestId('atlas-view')).toBeVisible()
})

test('Plain digit keys without Cmd do not navigate', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('home-view')).toBeVisible()

  await page.keyboard.press('3')
  await expect(page.getByTestId('home-view')).toBeVisible()
  await expect(page.getByTestId('activity-view')).toHaveCount(0)
})
