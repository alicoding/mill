import { test, expect } from './fixtures/server'
import { openSettings } from './fixtures/settingsNav'

// Search settings (goal 0412 S2): one field above the group list,
// breadcrumbed results, jump-and-highlight, and a palette command per
// setting -- the ground goal 0412 S1 (#828) indexes every setting.

test('typing narrows the group list to breadcrumbed results; Enter jumps, highlights and focuses the row\'s control; Esc restores the groups', async ({ page }) => {
  await page.goto('/')
  await openSettings(page, 'general')

  const input = page.getByTestId('settings-search-input')
  await expect(input).toBeVisible()
  await expect(input).not.toBeFocused()

  await page.keyboard.press('Meta+f')
  await expect(input).toBeFocused()

  await input.fill('hotkey')
  await expect(page.getByTestId('settings-group-item-general')).toHaveCount(0)
  const result = page.getByTestId('settings-search-result').filter({ hasText: 'Global hotkey' })
  await expect(result).toBeVisible()
  await expect(result).toContainText('Shortcuts')

  await input.press('Enter')
  await expect(page.getByTestId('settings-pane-shortcuts')).toBeVisible()
  const row = page.locator('[data-setting-id="shortcuts.globalHotkey"]')
  await expect(row).toHaveClass(/searchHighlight/)
  await expect(page.getByTestId('set-summon-hotkey')).toBeFocused()
  // Amendment 1: an early build focused this control, then
  // GetSummonHotkey() resolved and swapped the subtree, dropping focus
  // to <body> -- a single toBeFocused() above can pass on the
  // transient true before that revert. Waiting for the row's own
  // readiness attribute (the exact condition
  // shared/settingsHighlight.ts's MutationObserver watches) rather
  // than a guessed delay proves the fetch actually settled before the
  // re-check below.
  await expect(row).toHaveAttribute('data-setting-ready', 'true')
  await expect(page.getByTestId('set-summon-hotkey')).toBeFocused()

  // The field keeps its query after a jump (design contract item 3) --
  // Esc is what restores the plain group list.
  await expect(input).toHaveValue('hotkey')
  await input.press('Escape')
  await expect(input).toHaveValue('')
  await expect(page.getByTestId('settings-group-item-general')).toBeVisible()
})

test('an unmatched query shows the one-sentence empty state', async ({ page }) => {
  await page.goto('/')
  await openSettings(page, 'general')

  await page.getByTestId('settings-search-input').fill('zzzzznonsense')
  await expect(page.getByTestId('settings-search-empty')).toHaveText('No settings match "zzzzznonsense"')
  await expect(page.getByTestId('settings-search-result')).toHaveCount(0)
})

test('a palette "Setting: <label>" command jumps to the owning pane and highlights the row', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('sidebar-nav')).toBeVisible()

  await page.keyboard.press('Meta+k')
  const dialog = page.getByRole('dialog', { name: 'Command palette' })
  await dialog.getByRole('combobox').fill('Launch Mill at login')
  const option = dialog.getByRole('option', { name: /Setting: Launch Mill at login/ })
  await expect(option).toBeVisible()
  await option.click()
  await expect(dialog).toHaveCount(0)

  await expect(page.getByTestId('settings-view')).toBeVisible()
  await expect(page.getByTestId('settings-pane-general')).toBeVisible()
  const row = page.locator('[data-setting-id="general.launchAtLogin"]')
  await expect(row).toHaveClass(/searchHighlight/)
})
