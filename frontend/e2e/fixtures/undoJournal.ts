import { expect, type Page } from '@playwright/test'

// The app's ⌘Z/⇧⌘Z over its one actor-scoped journal (ADR-0044). The
// shortcut is armed only while the journal reports something to undo,
// and that state arrives one round trip after the edit's own dataevent
// -- so a press made the instant an edit lands is swallowed. These two
// wait for the armed state (shared/useUndoJournal publishes it on the
// document element) before pressing, which is also what a user does:
// they cannot press before the app has caught up either.

export async function pressUndo(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-mill-undo', 'available')
  await page.keyboard.press('Meta+z')
}

export async function pressRedo(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-mill-redo', 'available')
  await page.keyboard.press('Meta+Shift+z')
}
