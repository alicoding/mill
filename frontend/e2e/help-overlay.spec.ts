import { test, expect } from './fixtures/server'
import { gotoAppReady } from './fixtures/appReady'

// The bare-?/⌘? shortcuts-help overlay (goal 0071, app/ShortcutsHelpDialog.tsx):
// context-first ("On this page" bindings ahead of "Everywhere"),
// generated from the command registry (shared/commands.ts). `?` is a
// real, in-window keydown here (app/useKeymapDispatch.ts's own second
// listener), same reasoning every other keyboard spec in this suite
// already documents for why a real keypress is the right level to test
// at, not a stand-in.

function helpDialog(page: import('@playwright/test').Page) {
  return page.locator('[data-component="shortcuts-help"]')
}

test('bare ? on Atlas opens the overlay context-first, Esc closes it', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-view')).toBeVisible()

  await page.keyboard.press('?')
  await expect(helpDialog(page)).toBeVisible()
  await expect(helpDialog(page).getByText('On this page')).toBeVisible()
  await expect(helpDialog(page).getByText('Go up one level')).toBeVisible()
  await expect(helpDialog(page).getByText('Jump to a card')).toBeVisible()
  await expect(helpDialog(page).getByText('Everywhere')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(helpDialog(page)).toHaveCount(0)
})

test('typing ? inside the atlas jump dialog\'s own search input does not also open the help overlay', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await page.keyboard.press('Meta+k')
  const jumpInput = page.getByTestId('atlas-jump-input')
  await expect(jumpInput).toBeFocused()
  await jumpInput.press('?')

  await expect(helpDialog(page)).toHaveCount(0)
  await expect(page.locator('[data-component="atlas-jump-dialog"]')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('Cmd+Shift+/ (⌘?) opens the help overlay, not the palette; Cmd+/ still opens the palette', async ({ page }) => {
  await gotoAppReady(page)
  const paletteDialog = page.getByRole('dialog', { name: 'Command palette' })

  await page.keyboard.press('Meta+Shift+/')
  await expect(helpDialog(page)).toBeVisible()
  await expect(paletteDialog).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(helpDialog(page)).toHaveCount(0)

  await page.keyboard.press('Meta+/')
  await expect(paletteDialog).toBeVisible()
  await expect(helpDialog(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
})

test('the command palette on Atlas lists "Jump to a card" with its ⌘K chip under "On this page"', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await page.keyboard.press('Meta+/')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await expect(palette.getByText('On this page')).toBeVisible()
  const jumpOption = palette.getByRole('option', { name: /Jump to a card/ })
  await expect(jumpOption).toBeVisible()
  await expect(jumpOption).toContainText('⌘K')
  await page.keyboard.press('Escape')
})

test('"Open coverage" from the palette on Atlas switches to the coverage view', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await page.keyboard.press('Meta+/')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByRole('combobox').fill('Open coverage')
  const option = page.getByRole('option', { name: 'Open coverage' })
  await expect(option).toBeVisible()
  await option.click()

  await expect(page.locator('[data-component="atlas-coverage-pane"]')).toBeVisible()
})

test('"Rebind in Settings" in the overlay footer navigates to Settings and closes the overlay', async ({ page }) => {
  await page.goto('/')
  // The shell paints after a short async boot (plugins load first --
  // docs/goals/0249); a keypress before anything is visible is not a
  // user primitive, so the first press waits for the painted nav.
  await expect(page.getByTestId('sidebar-nav')).toBeVisible()
  await page.keyboard.press('?')
  await expect(helpDialog(page)).toBeVisible()

  await page.getByTestId('shortcuts-help-rebind').click()
  await expect(helpDialog(page)).toHaveCount(0)
  await expect(page.getByTestId('settings-view')).toBeVisible()
  await expect(page.locator('[data-testid="keymap-list"]')).toBeVisible()
})

// shared/atlasBoardCommands.ts's new Atlas commands: hintOnly ones
// still render their own real hint chip here (atlas.selectAll's ⌘A,
// atlas.delete.selection's ⌫, atlas.group.selection's G); palette-only
// commands with no default binding (atlas.arrange, atlas.import) are
// deliberately absent -- same "unbound stays out of the overlay"
// behavior atlas.matrix/atlas.coverage already have.
test('the overlay shows hint chips for the new Atlas commands, and omits unbound palette-only ones', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-view')).toBeVisible()

  await page.keyboard.press('?')
  const dialog = helpDialog(page)
  await expect(dialog).toBeVisible()

  const selectAllRow = dialog.locator('[data-command-id="atlas.selectAll"]')
  await expect(selectAllRow).toContainText('Select all')
  await expect(selectAllRow).toContainText('⌘A')

  await expect(dialog.locator('[data-command-id="atlas.delete.selection"]')).toContainText('⌫')
  await expect(dialog.locator('[data-command-id="atlas.group.selection"]')).toContainText('G')

  await expect(dialog.locator('[data-command-id="atlas.arrange"]')).toHaveCount(0)
  await expect(dialog.locator('[data-command-id="atlas.import"]')).toHaveCount(0)

  await page.keyboard.press('Escape')
})

test('the board keyboard-nav key table (goal 0104) is fully advertised here, each unreachable via the palette', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-view')).toBeVisible()

  await page.keyboard.press('?')
  const dialog = helpDialog(page)
  await expect(dialog).toBeVisible()

  await expect(dialog.locator('[data-command-id="atlas.focusNext"]')).toContainText('TAB')
  await expect(dialog.locator('[data-command-id="atlas.focusPrevious"]')).toContainText('TAB')
  await expect(dialog.locator('[data-command-id="atlas.focusDirection"]')).toContainText('⌥→')
  await expect(dialog.locator('[data-command-id="atlas.openFocused"]')).toContainText('↩')
  await expect(dialog.locator('[data-command-id="atlas.nudgeSelection"]')).toContainText('→')
  await expect(dialog.locator('[data-command-id="atlas.escapeLadder"]')).toBeVisible()

  await page.keyboard.press('Escape')

  // paletteHidden (real handling stays in useAtlasKeyboardNav.ts's own
  // window listener; a palette click would be a dead click since none
  // of these have a live board target the palette can supply).
  await page.keyboard.press('Meta+/')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox').fill('Focus next card')
  await expect(palette.getByRole('option', { name: 'Focus next card' })).toHaveCount(0)
  await page.keyboard.press('Escape')
})
