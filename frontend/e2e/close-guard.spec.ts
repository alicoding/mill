import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import { workflowRow, activePanel } from './fixtures/canvas'

// The unsaved-changes close guard (docs/goals/0048-unsaved-close-
// guard.md): every close path (mouse ✕/Back/overflow, keyboard
// ⌘W/⌘⇧W/⌘⌥W) sets the same workTabCloseRequest store signal
// (shared/store.ts), consumed by the one guard hook
// (app/useWorkTabCloseGuard.tsx). Only representative interactions are
// covered here -- a single-tab keyboard close, a single-tab mouse
// close, a bulk close, and a close-others -- since the mouse and
// keyboard paths are structurally the same call into the identical
// signal (proven by code, not needing a duplicate e2e case per path),
// and every (kind, dirty-set) combination the guard's decision itself
// can hit is exhaustively covered by workTabs.test.ts's
// dirtyKeysForCloseRequest suite.
//
// Deliberately avoids every clipboard-touching node, same reasoning as
// hot-exit.spec.ts's own header comment -- nothing here needs
// withClipboardLock.

// Polls localStorage for the debounced hot-exit scratch write
// (canvasScratch.ts, ~500ms) to actually contain `marker`, same
// reasoning as hot-exit.spec.ts's own copy: a fixed wait can race a
// second debounce re-arm from the authoring-validation surface.
async function waitForScratchWrite(page: import('@playwright/test').Page, marker: string) {
  await expect
    .poll(() =>
      page.evaluate((needle) => {
        for (const key of Object.keys(localStorage)) {
          if (!key.startsWith('mill-canvas-scratch:')) continue
          if ((localStorage.getItem(key) ?? '').includes(needle)) return true
        }
        return false
      }, marker),
    )
    .toBe(true)
}

async function hasAnyScratch(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('mill-canvas-scratch:')))
}

// Composes and saves a real workflow, so there's an existing entity to
// reopen and dirty -- built-in workflows have no Edit control
// (SPEC.md §2.2).
async function createSavedWorkflow(page: import('@playwright/test').Page, label: string) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByLabel('Label').fill(label)
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(workflowRow(page, label)).toBeVisible()
}

// Reopens a saved workflow, switches it into edit mode, and dirties it
// by appending to the Label field -- the simplest real edit the
// canvas's own dirty-tracking (composition/useCanvasHotExit.ts) picks
// up, no node drag/connect needed.
async function reopenAndDirty(page: import('@playwright/test').Page, label: string, suffix: string) {
  await workflowRow(page, label).click()
  await activePanel(page).getByTestId('edit-workflow').click()
  await activePanel(page).getByLabel('Label').fill(label + suffix)
  await expect(page.getByTestId('dirty-indicator')).toBeVisible()
  await waitForScratchWrite(page, label + suffix)
}

test('a clean tab closes with no dialog, via both the ✕ button and Cmd+W', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  await page.getByTestId('new-workflow').click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await page.getByRole('button', { name: 'Close tab' }).click()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)

  await page.getByTestId('new-workflow').click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await page.keyboard.press('Meta+w')
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
})

test('single dirty tab: the ✕ button shows Save/Don\'t save/Cancel; Don\'t save discards the edit and clears scratch', async ({ page }) => {
  await createSavedWorkflow(page, 'E2E close-guard single')
  await reopenAndDirty(page, 'E2E close-guard single', ' edited')

  await page.getByRole('button', { name: 'Close tab' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  // The tab's displayed label comes from the saved workflow list, not
  // the in-progress unsaved edit -- proves the dialog names the right
  // (still-saved) entity.
  await expect(dialog).toContainText('E2E close-guard single')
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()

  await dialog.getByRole('button', { name: 'Don\'t save' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(await hasAnyScratch(page)).toBe(false)

  // Reopening shows the saved (unedited) state -- the discard was real.
  await workflowRow(page, 'E2E close-guard single').click()
  await expect(activePanel(page).getByLabel('Label')).toHaveValue('E2E close-guard single')

  await page.getByRole('button', { name: 'Close tab' }).click()
  await clickRowAction(page, workflowRow(page, 'E2E close-guard single'), 'Delete')
})

test('single dirty tab: Cmd+W then Save persists the draft and closes the tab on success', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByLabel('Label').fill('E2E close-guard save')
  await expect(page.getByTestId('dirty-indicator')).toBeVisible()

  await page.keyboard.press('Meta+w')
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).not.toBeVisible()

  // A successful save closes the tab itself (composition/CompositionCanvas.tsx's
  // onSaved) -- the row appearing proves the draft actually round-tripped
  // through Go, not just that the dialog closed.
  const row = workflowRow(page, 'E2E close-guard save')
  await expect(row).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(1)

  await clickRowAction(page, row, 'Delete')
})

test('bulk close (Cmd+Shift+W) with a dirty tab shows a summary confirm; Cancel leaves tabs and dirty state untouched, confirming closes and clears scratch', async ({ page }) => {
  await createSavedWorkflow(page, 'E2E close-guard bulk')
  await reopenAndDirty(page, 'E2E close-guard bulk', ' edited')

  // Scoped to the titlebar band (docs/goals/BACKLOG.md's own titlebar-
  // tabs testid, same as keymap.spec.ts) -- a real editor tab also
  // holds its own Canvas/Runs/Versions inner tabs, which are role=tab
  // too and would otherwise inflate a page-wide count.
  const workTabStrip = page.getByTestId('titlebar-tabs')

  await page.keyboard.press('Meta+Shift+w')
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Close all tabs?')
  await expect(dialog).toContainText('1 tab has unsaved changes.')

  // Cancel: nothing closes, the dirty dot survives.
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(workTabStrip.getByRole('tab')).toHaveCount(2)
  await expect(page.getByTestId('dirty-indicator')).toBeVisible()

  // Confirm: closes the tab and clears its scratch.
  await page.keyboard.press('Meta+Shift+w')
  await dialog.getByRole('button', { name: 'Close tabs' }).click()
  await expect(workTabStrip.getByRole('tab')).toHaveCount(1)
  await expect(await hasAnyScratch(page)).toBe(false)

  await workflowRow(page, 'E2E close-guard bulk').click()
  await expect(activePanel(page).getByLabel('Label')).toHaveValue('E2E close-guard bulk')
  await page.getByRole('button', { name: 'Close tab' }).click()
  await clickRowAction(page, workflowRow(page, 'E2E close-guard bulk'), 'Delete')
})

test('Cmd+Alt+W (close others) with one dirty non-kept tab shows the close-others summary and keeps the active tab', async ({ page }) => {
  await createSavedWorkflow(page, 'E2E close-guard others')
  await reopenAndDirty(page, 'E2E close-guard others', ' edited')
  const workTabStrip = page.getByTestId('titlebar-tabs')

  // A second, clean tab becomes the active one -- closing "others"
  // targets the dirty tab left behind, not this one. Cmd+N (not the
  // page's own "New workflow" button) since that button lives on the
  // Workflows list panel, currently hidden behind the active editor tab
  // (workflow.new itself works from anywhere in the Workflows area,
  // shared/commands.ts's isWorkflowsArea).
  await page.keyboard.press('Meta+n')
  await expect(workTabStrip.getByRole('tab')).toHaveCount(3)

  await page.keyboard.press('Meta+Alt+w')
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Close other tabs?')
  await dialog.getByRole('button', { name: 'Close tabs' }).click()

  await expect(workTabStrip.getByRole('tab')).toHaveCount(2) // pinned page tab + the kept New workflow tab
  await expect(workTabStrip.getByRole('tab', { name: 'New workflow' })).toBeVisible()
  await expect(await hasAnyScratch(page)).toBe(false)

  await page.getByRole('button', { name: 'Close tab' }).click()
  await clickRowAction(page, workflowRow(page, 'E2E close-guard others'), 'Delete')
})

// docs/goals/0407-tab-close-activation.md: which tab activates after a
// real ⌘W/✕ close on the ACTIVE tab -- most-recently-used first (the
// editor rule), a neighbour when the closed tab left no recorded
// successor, the page tab once nothing remains. workTabs.test.ts's
// nextActiveAfterClose table covers every branch of the pure decision
// in isolation; these three drive it end to end through real
// keyboard/pointer primitives.

test('closing the active tab returns to the most recently used tab, not the first one', async ({ page }) => {
  await createSavedWorkflow(page, 'E2E tab-mru A')
  await createSavedWorkflow(page, 'E2E tab-mru B')
  await createSavedWorkflow(page, 'E2E tab-mru C')
  const workTabStrip = page.getByTestId('titlebar-tabs')

  // Activate A, then B, then C -- MRU order is now A, B, C. The
  // Workflows list panel is the page tab's own content, hidden behind
  // whichever work tab is active, so it's reselected between each row
  // click to reach the next row.
  await workflowRow(page, 'E2E tab-mru A').click()
  await workTabStrip.getByRole('tab', { name: 'Workflows' }).click()
  await workflowRow(page, 'E2E tab-mru B').click()
  await workTabStrip.getByRole('tab', { name: 'Workflows' }).click()
  await workflowRow(page, 'E2E tab-mru C').click()
  await expect(workTabStrip.getByRole('tab')).toHaveCount(4) // page tab + 3
  await expect(workTabStrip.getByRole('tab', { selected: true })).toHaveText('E2E tab-mru C')

  // C is active; Cmd+W returns to B -- the tab visited just before it
  // -- never A, the first tab (the browser's own right-neighbour rule
  // does not apply here).
  await page.keyboard.press('Meta+w')
  await expect(workTabStrip.getByRole('tab')).toHaveCount(3)
  await expect(workTabStrip.getByRole('tab', { selected: true })).toHaveText('E2E tab-mru B')

  await page.keyboard.press('Meta+w')
  await page.keyboard.press('Meta+w')
  for (const label of ['E2E tab-mru A', 'E2E tab-mru B', 'E2E tab-mru C']) {
    await clickRowAction(page, workflowRow(page, label), 'Delete')
  }
})

test('closing a re-activated middle tab returns to its right neighbour', async ({ page }) => {
  await createSavedWorkflow(page, 'E2E tab-neighbour A')
  await createSavedWorkflow(page, 'E2E tab-neighbour B')
  await createSavedWorkflow(page, 'E2E tab-neighbour C')
  const workTabStrip = page.getByTestId('titlebar-tabs')

  await workflowRow(page, 'E2E tab-neighbour A').click()
  await workTabStrip.getByRole('tab', { name: 'Workflows' }).click()
  await workflowRow(page, 'E2E tab-neighbour B').click()
  await workTabStrip.getByRole('tab', { name: 'Workflows' }).click()
  await workflowRow(page, 'E2E tab-neighbour C').click()

  // Only the middle tab gets a further explicit activation -- A and C
  // were never revisited after the initial open above.
  await workTabStrip.getByRole('tab', { name: 'E2E tab-neighbour B' }).click()
  await expect(workTabStrip.getByRole('tab', { selected: true })).toHaveText('E2E tab-neighbour B')

  await page.keyboard.press('Meta+w')
  await expect(workTabStrip.getByRole('tab')).toHaveCount(3)
  await expect(workTabStrip.getByRole('tab', { selected: true })).toHaveText('E2E tab-neighbour C')

  await page.keyboard.press('Meta+w')
  await page.keyboard.press('Meta+w')
  for (const label of ['E2E tab-neighbour A', 'E2E tab-neighbour B', 'E2E tab-neighbour C']) {
    await clickRowAction(page, workflowRow(page, label), 'Delete')
  }
})

test('closing the last remaining tab returns to the page tab', async ({ page }) => {
  await createSavedWorkflow(page, 'E2E tab-last')
  const workTabStrip = page.getByTestId('titlebar-tabs')

  await workflowRow(page, 'E2E tab-last').click()
  await expect(workTabStrip.getByRole('tab')).toHaveCount(2)

  await page.keyboard.press('Meta+w')
  await expect(workTabStrip.getByRole('tab')).toHaveCount(1)
  await expect(workTabStrip.getByRole('tab', { selected: true })).toHaveText('Workflows')

  await clickRowAction(page, workflowRow(page, 'E2E tab-last'), 'Delete')
})
