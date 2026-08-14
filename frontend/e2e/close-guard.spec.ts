import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

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

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

// See composition.spec.ts's own copy of this helper for the full
// reasoning (Primer's TabPanel keeps every open tab mounted, toggling
// `hidden` rather than unmounting).
function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

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
