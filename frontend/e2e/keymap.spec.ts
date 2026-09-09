import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import { workflowRow, activePanel } from './fixtures/canvas'
import { openSettings } from './fixtures/settingsNav'
import { gotoAppReady } from './fixtures/appReady'
import { hintText, pinMacPlatform } from './fixtures/keybindingHint'

pinMacPlatform(test)

// Exercises docs/goals/0016-keymap-system.md's command registry +
// in-window keybinding dispatch (shared/commands.ts, App.tsx's one
// keydown listener) over real Go bindings (Wails3 server mode), same
// setup as every other spec in this suite. The ⌘W-family native-menu
// reroute (SettingsService.ReleaseMenuAccelerators) only exists inside
// the real desktop webview's NSMenu -- server-mode Playwright has no
// native application menu at all, so what's actually under test here is
// the JS-level command dispatch ⌘W now reaches (tab.close): a real
// desktop-app press is verified manually (.claude/skills/run-mill),
// never faked here.

test('Cmd+S in a workflow editor tab saves', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByLabel('Label').fill('E2E keymap save')

  await page.keyboard.press('Meta+s')

  // Save always closes the tab on success (composition/CompositionCanvas.tsx's
  // onSaved) -- the same "row appears in the list" assertion every other
  // Save-button spec already uses proves it round-tripped through Go.
  const row = workflowRow(page, 'E2E keymap save')
  await expect(row).toBeVisible()

  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
})

test('Cmd+N opens a new-workflow tab', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  // The titlebar band (app/App.tsx + app/WorkTabShell.tsx, Chrome-style
  // tabs-in-titlebar) always renders -- it IS the titlebar -- so with no
  // work tab open yet, `role=tab` still matches exactly one element: the
  // pinned Workflows page tab. So this asserts an absolute count (1: the
  // pinned tab alone), not zero.
  await expect(page.getByRole('tab')).toHaveCount(1)

  await page.keyboard.press('Meta+n')

  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('tab', { name: 'Workflows' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'New workflow' })).toBeVisible()

  await page.getByRole('button', { name: 'Close tab' }).click()
  // Closing the only open work tab drops back to just the pinned page
  // tab (same reasoning as above, in reverse) -- never zero, the band
  // itself never disappears.
  await expect(page.getByRole('tab')).toHaveCount(1)
})

test('The titlebar band exists and holds the pinned page tab even with zero work tabs open', async ({ page }) => {
  // Chrome-style tabs-in-titlebar (a deliberate design choice): the band
  // (app/App.tsx's own .titlebar element, data-testid="titlebar-tabs")
  // is a real, always-present element -- not conditional chrome that
  // only shows up once a work tab is open, the way the old
  // WorkTabShell-owned strip was. Assert both: the band itself exists,
  // and the pinned page tab (portaled into it by WorkTabShell) is
  // inside it, with nothing else open.
  await page.goto('/')
  const band = page.getByTestId('titlebar-tabs')
  await expect(band).toBeVisible()
  await expect(band.getByRole('tab', { name: 'Home' })).toBeVisible()

  await page.getByRole('link', { name: 'Workflows' }).click()
  await expect(band.getByRole('tab', { name: 'Workflows' })).toBeVisible()
  // Still exactly one tab -- the page tab alone, no work tabs open.
  await expect(band.getByRole('tab')).toHaveCount(1)
})

test('Ctrl+Tab / Ctrl+Shift+Tab cycle the work-tab strip, wrapping through the pinned Workflows tab', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  // Two distinct 'workflow-new' tabs -- shared/store.ts's own
  // sameWorkTarget never reuses a workflow-new tab, so two Cmd+N
  // presses genuinely open two.
  await page.keyboard.press('Meta+n')
  await page.keyboard.press('Meta+n')

  const newWorkflowTabs = page.getByRole('tab', { name: 'New workflow' })
  await expect(newWorkflowTabs).toHaveCount(2)
  await expect(newWorkflowTabs.nth(1)).toHaveAttribute('aria-selected', 'true')

  // Ring order is [pinned Workflows tab, tab 1, tab 2] -- Next from the
  // last work tab wraps back to the pinned tab.
  await page.keyboard.press('Control+Tab')
  await expect(page.getByRole('tab', { name: 'Workflows' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('composition-view')).toBeVisible()

  await page.keyboard.press('Control+Tab')
  await expect(newWorkflowTabs.nth(0)).toHaveAttribute('aria-selected', 'true')

  // Prev walks the ring the other way, wrapping from the first work tab
  // back to the pinned tab.
  await page.keyboard.press('Control+Shift+Tab')
  await expect(page.getByRole('tab', { name: 'Workflows' })).toHaveAttribute('aria-selected', 'true')

  // Cleanup via each tab's own close control -- deliberately not more
  // keyboard commands, so cleanup doesn't depend on the behavior just
  // asserted above still being correct.
  while (await newWorkflowTabs.count() > 0) {
    await page.getByRole('button', { name: 'Close tab' }).first().click()
  }
  await expect(newWorkflowTabs).toHaveCount(0)
})

test('Cmd+W closes the active work tab via the JS-level command dispatch (native ⌘W→Close-menu-item interception is desktop-manual, not e2e-covered)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await expect(page.getByRole('tab')).toHaveCount(2) // pinned Workflows + the new one

  await page.keyboard.press('Meta+w')

  // Closing the only open work tab drops back to just the pinned
  // Workflows page tab (the titlebar band always shows at least that
  // one -- app/App.tsx + app/WorkTabShell.tsx) -- and, critically, this
  // is JS state closing a work tab, never a closed window/app (the
  // whole point of the ⌘W reroute, docs/goals/0016): the underlying
  // Workflows page is still right there, unaffected.
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByTestId('composition-view')).toBeVisible()
})

test('Settings: rebinding a command persists, the new combo works, and a conflicting rebind is rejected', async ({ page }) => {
  await page.goto('/')
  await openSettings(page, 'shortcuts')

  const saveRow = page.locator('[data-testid="keymap-row"][data-command-id="workflow.save"]')
  await expect(saveRow).toBeVisible()
  // goal 0405 S1: the combo renders through Primer's own KeybindingHint
  // (@primer/react/experimental) -- hintText() reads its aria-hidden
  // glyph span, not the full textContent (which also carries a
  // visually-hidden accessible name Playwright's own toHaveText would
  // otherwise match against too).
  await expect.poll(() => hintText(saveRow.getByTestId('keymap-row-combo'))).toBe('⌘S')

  // Rebind workflow.save off its ⌘S default onto ⌘⇧S.
  await saveRow.getByTestId('keymap-row-combo').click()
  await expect(saveRow.getByText(/press a combo/i)).toBeVisible()
  await page.keyboard.press('Meta+Shift+S')
  await expect.poll(() => hintText(saveRow.getByTestId('keymap-row-combo'))).toBe('⌘⇧S')
  await expect(saveRow.getByTestId('keymap-row-reset')).toBeVisible()

  // Persists across a reload (SettingsService.SetKeybinding, a real
  // settings-store write, not just local component state).
  await page.reload()
  await openSettings(page, 'shortcuts')
  const reloadedRow = page.locator('[data-testid="keymap-row"][data-command-id="workflow.save"]')
  await expect.poll(() => hintText(reloadedRow.getByTestId('keymap-row-combo'))).toBe('⌘⇧S')

  // The new combo actually works end to end -- open a workflow editor,
  // press the REBOUND combo (not the old ⌘S default, which no command
  // is bound to anymore), confirm it saved.
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByLabel('Label').fill('E2E rebound save')
  await page.keyboard.press('Meta+Shift+S')
  const savedRow = workflowRow(page, 'E2E rebound save')
  await expect(savedRow).toBeVisible()
  await clickRowAction(page, savedRow, 'Delete')

  // A rebind that collides with ANOTHER command's still-DEFAULT binding
  // (workflow.new's own ⌘N -- never itself overridden) is rejected too,
  // naming the conflicting command -- the frontend-side half of the
  // conflict check (composition/hotkeyCapture.ts's useCommandKeybindingCapture),
  // since only shared/commands.ts knows every command's default.
  await openSettings(page, 'shortcuts')
  const saveRowAgain = page.locator('[data-testid="keymap-row"][data-command-id="workflow.save"]')
  await saveRowAgain.getByTestId('keymap-row-combo').click()
  await page.keyboard.press('Meta+n')
  await expect(saveRowAgain.getByText(/already bound to command/i)).toBeVisible()
  // Rejected -- still shows the ⌘⇧S override from above, never ⌘N.
  await expect.poll(() => hintText(saveRowAgain.getByTestId('keymap-row-combo'))).toBe('⌘⇧S')

  // Cleanup -- reset workflow.save back to its default so this doesn't
  // leak into any other spec sharing this worker's settings file
  // (.claude/rules/testing.md's within-file/within-worker discipline).
  await saveRowAgain.getByTestId('keymap-row-reset').click()
  await expect(saveRowAgain.getByTestId('keymap-row-reset')).toHaveCount(0)
  await expect.poll(() => hintText(saveRowAgain.getByTestId('keymap-row-combo'))).toBe('⌘S')
})

// docs/goals/BACKLOG.md Standing #6 -- ⌘/ as palette.open's own extra
// binding. commands.test.ts already covers dispatchCommandForEvent
// matching an extraBinding in isolation; this proves the live wiring
// (App.tsx's real keydown listener, the real Dialog toggling). ⌘⇧/
// moved off palette.open onto help.shortcuts (goal 0071) -- covered by
// e2e/help-overlay.spec.ts instead.
test('Cmd+/ (palette.open\'s extra binding) opens the command palette, same as Cmd+K', async ({ page }) => {
  await gotoAppReady(page)
  const paletteDialog = page.getByRole('dialog', { name: 'Command palette' })

  await page.keyboard.press('Meta+/')
  await expect(paletteDialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(paletteDialog).toHaveCount(0)
})

// Settings' Keyboard Shortcuts list renders the extras as read-only
// secondary chips (views/KeyboardShortcutsSection.tsx) -- distinct from
// the primary combo button above it, which stays the only
// click-to-rebind target.
test('Settings shows palette.open\'s extra binding as a read-only secondary chip', async ({ page }) => {
  await page.goto('/')
  await openSettings(page, 'shortcuts')

  const paletteRow = page.locator('[data-testid="keymap-row"][data-command-id="palette.open"]')
  await expect.poll(() => hintText(paletteRow.getByTestId('keymap-row-combo'))).toBe('⌘K')

  const extraChips = paletteRow.getByTestId('keymap-row-extra-binding')
  await expect(extraChips).toHaveCount(1)
  await expect.poll(() => hintText(extraChips.nth(0))).toBe('⌘/')

  // A command with no extraBindings (e.g. workflow.save) renders none.
  const saveRow = page.locator('[data-testid="keymap-row"][data-command-id="workflow.save"]')
  await expect(saveRow.getByTestId('keymap-row-extra-binding')).toHaveCount(0)
})

// goal 0405 S1: grouped by surface, bound-first, the unbound tail
// collapsed per group rather than one flat scroll -- and the two new
// ways into it (a facet, or capturing the chord itself).
test('Settings: groups by surface, folds the unbound tail behind a closed disclosure that a search or the Unbound facet reveals, and find-by-shortcut filters to the pressed chord', async ({ page }) => {
  await page.goto('/')
  await openSettings(page, 'shortcuts')

  // Bound-first, grouped by surface -- "Everywhere" (global commands,
  // workflow.save among them) and "Atlas" (atlas.up, atlas-scoped) both
  // render as their own ActionList.Group.
  const everywhereGroup = page.locator('[data-surface="everywhere"]')
  const atlasGroup = page.locator('[data-surface="atlas"]')
  await expect(everywhereGroup).toBeVisible()
  await expect(everywhereGroup.getByRole('heading', { name: 'Everywhere' })).toBeVisible()
  await expect(atlasGroup).toBeVisible()
  await expect(atlasGroup.getByRole('heading', { name: 'Atlas' })).toBeVisible()
  await expect(everywhereGroup.locator('[data-testid="keymap-row"][data-command-id="workflow.save"]')).toBeVisible()

  // Everywhere's own Unbound (n) disclosure starts closed -- workflow.runStepped
  // (shared/commands.ts's own defaultBinding: null) is inside it. A
  // closed native <details> keeps its content in the DOM (never
  // toHaveCount(0)) but not visible -- the same distinction every other
  // closed-by-default disclosure in this suite asserts on.
  const everywhereUnbound = page.getByTestId('keymap-unbound-everywhere')
  await expect(everywhereUnbound).toBeVisible()
  await expect(everywhereUnbound).not.toHaveAttribute('open', '')
  await expect(page.locator('[data-testid="keymap-row"][data-command-id="workflow.runStepped"]')).not.toBeVisible()

  // A non-empty search opens it automatically -- searching narrows to
  // exactly the unbound command and reveals it without an extra click.
  await page.getByTestId('keymap-search').fill('runStepped')
  await expect(everywhereUnbound).toHaveAttribute('open', '')
  await expect(page.locator('[data-testid="keymap-row"][data-command-id="workflow.runStepped"]')).toBeVisible()
  await page.getByTestId('keymap-search').fill('')

  // The Bound facet hides the unbound tail entirely (nothing left to
  // disclose in that group).
  await page.getByTestId('keymap-facet-bound').click()
  await expect(page.getByTestId('keymap-unbound-everywhere')).toHaveCount(0)
  await expect(everywhereGroup.locator('[data-testid="keymap-row"][data-command-id="workflow.save"]')).toBeVisible()
  await page.getByTestId('keymap-facet-all').click()

  // Find by shortcut: press the recorder, then the workflow.save combo
  // -- only commands bound to that exact chord remain, everywhere else
  // (including the Atlas group) drops out entirely.
  await page.getByTestId('keymap-find-by-shortcut').click()
  await expect(page.getByText(/press the shortcut/i)).toBeVisible()
  await page.keyboard.press('Meta+s')
  await expect(everywhereGroup.locator('[data-testid="keymap-row"][data-command-id="workflow.save"]')).toBeVisible()
  await expect(page.locator('[data-surface="atlas"]')).toHaveCount(0)
  await expect.poll(() => hintText(page.getByTestId('keymap-find-by-shortcut'))).toBe('⌘S')

  // Clicking the armed find-by-shortcut button again clears it, back to
  // the full list.
  await page.getByTestId('keymap-find-by-shortcut').click()
  await expect(page.locator('[data-surface="atlas"]')).toBeVisible()
})
