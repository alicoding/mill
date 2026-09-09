import type { Locator, Page } from '@playwright/test'

// Primer KeybindingHint (@primer/react/experimental, goal 0405 S1's
// KeyComboChip replacement) renders EVERY key as a pair: a visually-
// hidden (but DOM-present) accessible name, then an aria-hidden glyph
// span -- a bare textContent/toHaveText read picks up both, interleaved
// with the accessible words. This reads only the aria-hidden half,
// matching what a sighted user actually sees. `scope` is whatever
// testid/locator already narrows to ONE instance -- KeybindingHint
// itself renders the same static data-testid="keybinding-hint" on
// every instance on the page, never a unique one.
export async function hintText(scope: Locator): Promise<string> {
  const glyphs = await scope.getByTestId('keybinding-hint').locator('[aria-hidden="true"]').allTextContents()
  return glyphs.join('').replace(/\s+/g, '')
}

// pinMacPlatform: KeybindingHint picks glyph-vs-spelled-out rendering off
// the REAL browser's navigator.platform (no override hook in this Primer
// version); the ubuntu runner resolves to "other" ("Meta", not "⌘"). Only
// the specs that assert chip text need the shipped app's Mac glyphs, and
// the pin must stay scoped to them: pinning it for every spec (a first
// cut of goal 0405 S1) made CodeMirror/ProseMirror/Glide resolve their
// Mod key to Meta on Linux while the harness and Chromium's own native
// editing commands still used Control -- select-all never fired and
// typing merged into leftover text across unrelated specs. Call once at
// spec top level; it runs before each test's first navigation.
export function pinMacPlatform(test: { beforeEach: (fn: (args: { page: Page }) => Promise<void>) => void }) {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true })
    })
  })
}
