import { test, expect } from './fixtures/server'

// docs/goals/0015-summon-quick-invoke.md's inline-hotkey-hint remainder:
// the tab-overflow dropdown (app/WorkTabShell.tsx) now shows each
// bindable item's live shortcut (app/HotkeyHint.tsx, data-testid
// "hotkey-hint") next to it -- Chrome's own "Search Tabs" pattern, the
// owner's explicit ask -- and "Close other tabs"/"Close all tabs" carry
// REAL default bindings (⌘⌥W / ⌘⇧W, shared/commands.ts's
// tab.closeOthers/tab.closeAll), not just a display-only label.

async function openTwoNewWorkflowTabs(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  // Meta+n (workflow.new), not clicking the page's own "new-workflow"
  // button twice -- the first click opens a workflow-new tab that
  // covers the Workflows list panel (and its button) entirely, so a
  // second click on the same locator would hang waiting for an element
  // that's no longer visible. Cmd+N still works from inside an already-
  // open workflow-new tab (shared/commands.ts's isWorkflowsArea also
  // treats an active workflow-edit/-new tab as "in the Workflows area"),
  // matching e2e/keymap.spec.ts's own "Ctrl+Tab / Ctrl+Shift+Tab" test.
  await page.keyboard.press('Meta+n')
  await page.keyboard.press('Meta+n')
  await expect(page.getByRole('tab', { name: 'New workflow' })).toHaveCount(2)
}

test('the tab-overflow dropdown shows Close-other/Close-all inline hints, and Cmd+Shift+W actually closes every open tab', async ({ page }) => {
  await openTwoNewWorkflowTabs(page)

  const overflow = page.getByTestId('work-tab-overflow')
  await overflow.click()

  const closeOthersItem = page.getByRole('menuitem', { name: 'Close other tabs' })
  const closeAllItem = page.getByRole('menuitem', { name: 'Close all tabs' })
  await expect(closeOthersItem).toBeVisible()
  await expect(closeAllItem).toBeVisible()
  // shared/keybinding.ts's formatCombo output for each command's real
  // default binding -- read live off shared/commands.ts + the store's
  // keybindingOverrides via app/HotkeyHint.tsx, not a hardcoded label.
  await expect(closeOthersItem.getByTestId('hotkey-hint')).toHaveText('⌘⌥W')
  await expect(closeAllItem.getByTestId('hotkey-hint')).toHaveText('⌘⇧W')

  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)

  // The shortcut is real, not just displayed: Cmd+Shift+W (tab.closeAll)
  // drops every open work tab, back to just the pinned Workflows page
  // tab -- the overflow button itself disappears too (shown only at 2+
  // work tabs).
  await page.keyboard.press('Meta+Shift+w')
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByRole('tab', { name: 'Workflows' })).toBeVisible()
  await expect(overflow).toHaveCount(0)
})

test('Cmd+Option+W (tab.closeOthers) closes every tab except the active one', async ({ page }) => {
  await openTwoNewWorkflowTabs(page)

  // The second 'New workflow' tab opened is the active one (store.ts's
  // sameWorkTarget never reuses a workflow-new tab, matching keymap.spec.ts's
  // own "Ctrl+Tab / Ctrl+Shift+Tab" test) -- tab.closeOthers keeps it and
  // drops the first.
  await page.keyboard.press('Meta+Alt+w')
  await expect(page.getByRole('tab', { name: 'New workflow' })).toHaveCount(1)
  await expect(page.getByRole('tab', { name: 'New workflow' })).toHaveAttribute('aria-selected', 'true')

  // Cleanup.
  await page.getByRole('button', { name: 'Close tab' }).click()
  await expect(page.getByRole('tab', { name: 'New workflow' })).toHaveCount(0)
})

test('Settings: rebinding Close other tabs updates the SAME inline hint the tab-overflow dropdown renders (O(1) single source of truth)', async ({ page }) => {
  await openTwoNewWorkflowTabs(page)

  const overflow = page.getByTestId('work-tab-overflow')
  await overflow.click()
  const closeOthersItem = page.getByRole('menuitem', { name: 'Close other tabs' })
  await expect(closeOthersItem.getByTestId('hotkey-hint')).toHaveText('⌘⌥W')
  await page.keyboard.press('Escape')

  // Rebind tab.closeOthers off its ⌘⌥W default onto Ctrl+Shift+O (no
  // collision with any other command's default or a RESERVED_COMBOS
  // entry, shared/keybinding.ts).
  await page.getByRole('link', { name: 'Settings' }).click()
  const row = page.locator('[data-testid="keymap-row"][data-command-id="tab.closeOthers"]')
  await expect(row.getByTestId('keymap-row-combo')).toHaveText('⌘⌥W')
  await row.getByTestId('keymap-row-combo').click()
  await page.keyboard.press('Control+Shift+O')
  await expect(row.getByTestId('keymap-row-combo')).toHaveText('⌃⇧O')

  // Back on Workflows, the tab-overflow dropdown's hint -- reading off
  // the exact same shared/store.ts keybindingOverrides Settings just
  // wrote -- reflects the new combo without any code path re-deriving
  // it independently.
  await page.getByRole('link', { name: 'Workflows' }).click()
  // Navigating via the sidebar resets activeWorkTabKey to null
  // (shared/store.ts's setView -- switching sections always drops back
  // to the pinned page tab) -- click into one of the still-open work
  // tabs to have a real "active" tab again, the same precondition
  // WorkTabShell's own "Close other tabs" item requires (its
  // `disabled={activeWorkTabKey === null}`).
  await page.getByRole('tab', { name: 'New workflow' }).first().click()
  await overflow.click()
  await expect(closeOthersItem.getByTestId('hotkey-hint')).toHaveText('⌃⇧O')
  await page.keyboard.press('Escape')

  // And the rebound combo is the one that's actually live now -- not
  // just displayed -- while the old default no longer does anything.
  await page.keyboard.press('Control+Shift+O')
  await expect(page.getByRole('tab', { name: 'New workflow' })).toHaveCount(1)

  // Cleanup: reset the override and close the remaining tab, so this
  // doesn't leak into any other spec sharing this worker's settings file
  // (.claude/rules/testing.md's within-file/within-worker discipline).
  await page.getByRole('link', { name: 'Settings' }).click()
  const rowAgain = page.locator('[data-testid="keymap-row"][data-command-id="tab.closeOthers"]')
  await rowAgain.getByTestId('keymap-row-reset').click()
  await expect(rowAgain.getByTestId('keymap-row-combo')).toHaveText('⌘⌥W')

  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByRole('button', { name: 'Close tab' }).click()
  await expect(page.getByRole('tab', { name: 'New workflow' })).toHaveCount(0)
})
