import type { Page } from '@playwright/test'

// The ⌘K command palette's own dialog locator (app/CommandPalette.tsx)
// -- promoted here once a second spec file needed it too
// (.claude/rules/testing.md's "a helper used by 2+ spec files MUST be
// promoted").
export function paletteDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Command palette' })
}
