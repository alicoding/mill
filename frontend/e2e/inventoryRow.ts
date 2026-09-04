import { expect, type Locator, type Page } from '@playwright/test'

// Shared e2e helper for InventoryList.tsx's row anatomy
// (docs/goals/0007-resource-inventory-redesign.md): Edit/Export/Delete/
// List tools all live behind one trailing ⋯ ActionMenu now, replacing
// the direct per-row icon buttons every spec used to click. Not a
// *.spec.ts file itself -- Playwright only picks up files matching its
// own testMatch glob, so this plain helper module doesn't run as a
// (empty) test file on its own.
//
// The menu's Overlay portals outside `row`'s own DOM subtree (Primer's
// AnchoredOverlay renders via a Portal, confirmed directly against its
// compiled source before relying on this), so the action item is
// looked up at the page level once the menu is open -- safe because
// only one row's menu is ever open at a time.
//
// Delete now routes through shared/ConfirmDialog.tsx (Button-semantics
// convention, .claude/rules/frontend.md rule (b)) -- selecting the
// menu item no longer destroys the entity directly, it opens a
// confirmation dialog naming it. Every existing caller of this helper
// stays unchanged; the confirm click is handled here once rather than
// at each of the ~40 call sites.
export async function clickRowAction(page: Page, row: Locator, actionLabel: string | RegExp) {
  // Read the row's own entity kind before Delete can act on it -- a
  // Configure entity deletes at once (goal 0270), removing this exact
  // row from the DOM as soon as the backend call resolves, so reading
  // the attribute AFTER clicking Delete races that removal (the read
  // finds no row left to read, and the locator never comes back).
  const entityKind = actionLabel === 'Delete' ? await row.getAttribute('data-entity') : null
  await row.getByTestId('inventory-row-menu').click()
  await page.getByRole('menuitem', { name: actionLabel }).click()
  // A workflow's Delete still confirms first; a Configure entity's
  // deletes at once and offers Undo (goal 0270).
  if (actionLabel === 'Delete' && entityKind === 'workflow') {
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  }
}

// The seeded examples sit in their own collapsible section at the
// bottom of every inventory (docs/goals/0337), collapsed as soon as the
// user owns anything in that list -- so a spec reaching for a SEEDED
// row after creating one of its own has to open the section first.
// No-op when the list has no examples section, or it is already open.
export async function expandExamples(page: Page, scope: Locator | Page = page) {
  await expect(page.getByTestId('list-toolbar').first()).toBeVisible()
  const toggle = scope.getByTestId('inventory-examples-toggle')
  if ((await toggle.count()) === 0) return
  if ((await toggle.first().getAttribute('aria-expanded')) === 'true') return
  await toggle.first().click()
  await expect(toggle.first()).toHaveAttribute('aria-expanded', 'true')
}
