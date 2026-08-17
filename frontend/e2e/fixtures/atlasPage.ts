import type { Locator, Page } from '@playwright/test'

// Read is edit (goal 0081 slice A5): the card page lost its collapsed
// "Edit card" disclosure -- every field is always visible and directly
// editable, so there is no more open-the-edit-section step before a
// test can reach a field. Delete moved behind the header's own kebab
// menu (rider (a)): this drives that flow (open menu -> Delete ->
// confirm) the same way every spec used to click the old edit
// section's bare Delete button. The kebab's own ActionMenu.Overlay
// portals its items outside the dialog's DOM subtree (the same reason
// atlas.spec.ts already queries atlas-add-sibling/atlas-add-child via
// the page, not a scoped container), so the menu item is queried off
// `page`, not `overlay`.
export async function deleteViaPageMenu(page: Page, overlay: Locator): Promise<void> {
  await overlay.getByTestId('atlas-page-menu').click()
  await page.getByTestId('atlas-page-menu-delete').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
}
