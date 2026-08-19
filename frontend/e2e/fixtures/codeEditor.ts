import type { Page } from '@playwright/test'

// CodeMirror renders no <textarea> -- its editable surface is a
// contenteditable `.cm-content` node inside the [data-testid] wrapper
// shared/CodeEditor.tsx renders. Replaces the whole document:
//
//  1. Click into `.cm-content` to focus it.
//  2. Select-all via the platform's own combo. CodeMirror's built-in
//     Mod-a binding checks the REAL running browser's navigator.platform
//     at match time (@codemirror/view's own `browser.mac` flag), so a
//     hardcoded modifier would only work on one OS -- process.platform is
//     a valid proxy here since Playwright always launches its browser on
//     this same machine, never a remote farm.
//  3. Delete the selection, then insert the new text via Playwright's
//     keyboard.insertText -- a native beforeinput/input path, not
//     per-character keydown -- so CodeEditor's closeBrackets extension
//     (which reacts to keydown) never double-inserts a bracket/quote CM6
//     already auto-closed while typing.
export async function fillCodeEditor(page: Page, testId: string, text: string) {
  const content = page.locator(`[data-testid="${testId}"] .cm-content`)
  await content.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
}
