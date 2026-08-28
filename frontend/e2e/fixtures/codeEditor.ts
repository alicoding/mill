import type { Locator, Page } from '@playwright/test'

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

// fillMilkdown drives a Milkdown-backed note editor (goal 0244 S3;
// replaces the old shared/CodeEditor-backed prose field, goal 0145) --
// the note's ONE markdown-canonical WYSIWYG door, used by both the
// sticky's own editing mount and MarkdownNoteField's. Real keystrokes
// (testing.md: user primitives, not synthetic events), never a bulk
// insertText: Milkdown's own input rules (## -> heading, **x** ->
// bold, - [ ] -> a task item) fire off the browser's native
// beforeinput stream typing produces, and a bulk single-shot
// insertText call was measured live to skip them entirely (the mark
// stays literal `**x**` text). Multi-line input types each line
// separately with a real Enter between -- a single .type() call
// carrying an embedded "\n" was measured live to scramble character
// order (Playwright's own newline-as-Enter synthesis racing
// Milkdown's async list/paragraph transactions), where a real user
// physically cannot generate that race (one key at a time).
//
// focus(), never click() -- carried over from the CodeMirror-era
// fillSticky this folds into (see blurSticky's own comment on why
// programmatic focus is still the deterministic door): a click on the
// STICKY specifically is a React Flow node click, which measured live
// to select-and-replace whatever else the board had selected (a real
// regression the multi-select suite caught). The draft/rendered mount
// this targets already autofocuses or accepts focus() directly, so a
// click was never load-bearing for any consumer.
export async function fillMilkdown(page: Page, testId: string, text: string) {
  const content = page.locator(`[data-testid="${testId}"] [contenteditable="true"]`)
  await content.waitFor()
  await content.focus()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await page.keyboard.press('Delete')
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.type(lines[i])
    if (i < lines.length - 1) await page.keyboard.press('Enter')
  }
}

// fillMarkdownNote drives the shared MarkdownNoteField (goal 0145) in
// either mode: a non-empty note renders at rest, so entering edit
// means clicking the rendered view first; an empty note IS the
// editor already.
export async function fillMarkdownNote(page: Page, testId: string, text: string) {
  const rendered = page.getByTestId(`${testId}-rendered`)
  if (await rendered.count()) await rendered.click()
  await fillMilkdown(page, testId, text)
}

// The sticky note's editing surface (goal 0145; Milkdown since goal
// 0244 S3). `fillSticky` replaces the draft text; `blurSticky` commits
// it. stickyEditor targets the wrapper MilkdownEditor renders --
// unchanged testid, so it doubles as the pre-engine textarea fallback
// locator too.
export function stickyEditor(page: Page) {
  return page.locator('[data-testid="atlas-sticky-editor"]')
}
export async function fillSticky(page: Page, text: string) {
  await fillMilkdown(page, 'atlas-sticky-editor', text)
}
// Commit is POINTER-driven now (AtlasStickyNode: a press outside the
// note, or the whole window losing focus) -- a real user's blur/tab-
// away is exactly the "press elsewhere" gesture, but Playwright's
// programmatic `.blur()` isn't a press at all, so it no longer
// commits anything. ⌘↵ (AtlasStickyNode's own keyboard shortcut,
// unaffected by the pointer-vs-focus split) is the deterministic
// commit path for a test -- kept named `blurSticky` so no spec churn.
export async function blurSticky(page: Page) {
  const content = page.locator('[data-testid="atlas-sticky-editor"] [contenteditable="true"], [data-testid="atlas-sticky-editor"] textarea').first()
  await content.focus()
  await page.keyboard.press('Control+Enter')
  await page.locator('[data-testid="atlas-sticky-editor"]').waitFor({ state: 'detached' })
}

// clickOutsideNoteEditor commits a page overlay's MarkdownNoteField
// (atlas-page-note / atlas-note-overlay-editor): its commit is also
// POINTER-driven (a press outside the field), so a real click lands
// it -- targeted at the header's own padding corner (never a child
// control) so the click can't hit anything but empty background.
export async function clickOutsideNoteEditor(overlay: Locator): Promise<void> {
  await overlay.getByTestId('atlas-page-header').click({ position: { x: 8, y: 8 } })
}
