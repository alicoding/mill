import type { Locator, Page } from '@playwright/test'

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
export async function clickRowAction(page: Page, row: Locator, actionLabel: string | RegExp) {
  await row.getByTestId('inventory-row-menu').click()
  await page.getByRole('menuitem', { name: actionLabel }).click()
}
