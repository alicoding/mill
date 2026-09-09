import type { Locator } from '@playwright/test'

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
