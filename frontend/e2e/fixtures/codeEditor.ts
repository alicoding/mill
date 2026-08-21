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

// fillMarkdownNote drives the markdown note field (goal 0145) in
// either mode: a non-empty note renders at rest, so entering edit
// means clicking the rendered view first; an empty note IS the
// editor already.
export async function fillMarkdownNote(page: Page, testId: string, text: string) {
  const rendered = page.getByTestId(`${testId}-rendered`)
  if (await rendered.count()) await rendered.click()
  await fillCodeEditor(page, testId, text)
}

// The sticky note's editing surface (goal 0145): the shared prose
// CodeEditor, or its pre-engine textarea fallback. `fillSticky`
// replaces the draft text; `blurSticky` commits it (the old inline
// textarea fill/blur pattern, centralized now that the surface is
// CM6). stickyEditor targets the wrapper CodeEditor renders.
export function stickyEditor(page: Page) {
  return page.locator('[data-testid="atlas-sticky-editor"]')
}
export async function fillSticky(page: Page, text: string) {
  // focus(), never click(): a click on the sticky is a React Flow
  // node click, which select-and-replaces whatever the test had
  // selected -- the draft editor autofocuses, so focus is enough.
  const content = page.locator('[data-testid="atlas-sticky-editor"] .cm-content')
  await content.waitFor()
  await content.focus()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
}
export async function blurSticky(page: Page) {
  // focus() before blur(): HTMLElement.blur() is a no-op on an
  // element that never held focus, and a fast test can blur before
  // the sticky's own deferred autofocus lands -- no focusout would
  // fire and the commit-on-blur never runs.
  await page.locator('[data-testid="atlas-sticky-editor"] .cm-content, [data-testid="atlas-sticky-editor"] textarea').first().evaluate((el) => {
    (el as HTMLElement).focus()
    ;(el as HTMLElement).blur()
  })
}
