import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { gotoAppReady } from './appReady'

// Getting a test onto the Atlas board itself (2+ specs,
// .claude/rules/testing.md's promotion rule). The branch reads the
// test's own KNOWN viewport rather than probing the DOM with a
// non-waiting isVisible(): the shell's nav collapses below 767px
// (App.module.css), and a snapshot probe can read the toggle as absent
// before the app has finished mounting.
export async function openAtlas(page: Page): Promise<void> {
  await gotoAppReady(page)
  const viewport = page.viewportSize()
  if (viewport && viewport.width < 767) {
    await page.getByTestId('mobile-nav-toggle').click()
  }
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-creation-tray')).toBeVisible()
}

// Read is edit (goal 0081 slice A5): the card page lost its collapsed
// "Edit card" disclosure -- every field is always visible and directly
// editable, so there is no more open-the-edit-section step before a
// test can reach a field. Delete moved behind the header's own kebab
// menu (rider (a)); goal 0093 made it instant, no confirm, closing the
// overlay itself. The kebab's own ActionMenu.Overlay portals its items
// outside the dialog's DOM subtree (the same reason atlas.spec.ts
// already queries atlas-add-sibling/atlas-add-child via the page, not
// a scoped container), so the menu item is queried off `page`, not
// `overlay`.
export async function deleteViaPageMenu(page: Page, overlay: Locator): Promise<void> {
  await overlay.getByTestId('atlas-page-menu').click()
  await page.getByTestId('atlas-page-menu-delete').click()
}
