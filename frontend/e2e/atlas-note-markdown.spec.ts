import { test, expect } from './fixtures/server'
import { clickCorner } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'
import { fillCodeEditor, fillMarkdownNote, fillSticky, stickyEditor, blurSticky } from './fixtures/codeEditor'

// Markdown sticky notes (goal 0145): the N tool's note is a real
// markdown surface -- the prose editor live-previews formatting while
// typing, and the resting face renders the markdown (lists, bold,
// headings), never the raw source. Shared worker pool: every entity
// this file creates is deleted before the test ends.

test('sticky notes render markdown; editor live-previews it', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await page.keyboard.press('n')
  await clickCorner(board, 'top-left')
  await expect(stickyEditor(page)).toBeVisible()
  await fillSticky(page, '# Plan\n\n- first\n- **second**')
  // Live preview inside the editor: the heading line carries the
  // decoration class at heading scale; a mark off the caret line
  // recedes.
  const h1 = page.locator('[data-testid="atlas-sticky-editor"] .cm-mill-h1')
  await expect(h1).toHaveCount(1)
  const size = await h1.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(size).toBeGreaterThan(14)
  await expect(page.locator('[data-testid="atlas-sticky-editor"] .cm-mill-mark').first()).toBeVisible()
  await blurSticky(page)
  await expect(stickyEditor(page)).toHaveCount(0)
  // At rest the text renders as markdown: a real list, bold, heading.
  const sticky = page.getByTestId('atlas-sticky-note')
  await expect(sticky.locator('li')).toHaveCount(2)
  await expect(sticky.locator('strong')).toHaveText('second')
  // The face shows rendered output only -- no raw marks survive.
  await expect(sticky).not.toContainText('**')
  // Regression: a REAL double-click enters edit -- the second press
  // used to beat the selection snapshot's re-render and no-op.
  await page.keyboard.press('Escape')
  await sticky.dblclick()
  await expect(stickyEditor(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(stickyEditor(page)).toHaveCount(0)

  // The big surface (goal 0154): ⌘-click opens the note overlay; the
  // same markdown machinery edits there -- the Dialog's own onClose
  // always commits the current draft (AtlasNoteOverlay.tsx), so
  // closing via Escape is itself the commit; the sticky face reflects
  // it after close.
  await sticky.click({ modifiers: ['Meta'] })
  const overlay = page.locator('[data-component="atlas-note-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.locator('li')).toHaveCount(2)

  // Regression (goal 0162): the rendered note reads as prose you can
  // click into, not a bordered read-only document -- no border, a
  // text cursor, and a hover background shift, and a real click opens
  // the editor.
  const overlayRendered = page.getByTestId('atlas-note-overlay-editor-rendered')
  await expect(overlayRendered).toHaveCSS('border-top-width', '0px')
  await expect(overlayRendered).toHaveCSS('cursor', 'text')
  const restBackground = await overlayRendered.evaluate((el) => getComputedStyle(el).backgroundColor)
  await overlayRendered.hover()
  await expect.poll(() => overlayRendered.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(restBackground)
  await overlayRendered.click()
  await expect(page.getByTestId('atlas-note-overlay-editor')).toBeVisible()

  await fillMarkdownNote(page, 'atlas-note-overlay-editor', '# Plan v2\n\n- first\n- **second**\n- third')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()
  await expect(sticky.locator('li')).toHaveCount(3)

  // Cleanup (testing.md's within-file discipline).
  const menu = contextMenu(page)
  await sticky.click({ button: 'right' })
  await menu.getByText('Delete note', { exact: true }).click()
  await expect(sticky).toHaveCount(0)
})

// Regression (goal 0193's no-auto-resize rule, goal 0199's own
// correction): the note overlay's markdown editor grew its own box
// with every typed line -- CodeEditor falls back to grow-to-fit
// unless its host constrains it, and MarkdownNoteField.module.css
// carried no such constraint. Fixed at the shared field
// (MarkdownNoteField), so AtlasCardPageFields.tsx's own mount inherits
// the same bound with no separate rule. Measures the rendered box
// itself, never anything wrap-dependent (CI's font stack differs from
// local -- #402's own lesson).
test("the note overlay's editor box stays bounded as content grows, never the page", async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await page.keyboard.press('n')
  await clickCorner(board, 'top-left')
  await expect(stickyEditor(page)).toBeVisible()
  await fillSticky(page, 'One line')
  await blurSticky(page)

  const sticky = page.getByTestId('atlas-sticky-note')
  await sticky.click({ modifiers: ['Meta'] })
  const overlay = page.locator('[data-component="atlas-note-overlay"]')
  await expect(overlay).toBeVisible()

  const overlayRendered = page.getByTestId('atlas-note-overlay-editor-rendered')
  await overlayRendered.click()
  const editor = page.getByTestId('atlas-note-overlay-editor')
  await expect(editor).toBeVisible()
  // The BOUNDED box, not CodeEditor's own inner wrapper -- that inner
  // element keeps its full unclipped intrinsic height by design
  // (MarkdownNoteField.tsx's own comment on -wrap explains why); the
  // outer .editorWrap is what actually stops growing.
  const wrap = page.getByTestId('atlas-note-overlay-editor-wrap')

  const shortBox = await wrap.boundingBox()
  if (!shortBox) throw new Error('no editor box')

  await fillCodeEditor(page, 'atlas-note-overlay-editor', Array.from({ length: 40 }, (_, i) => `Line number ${i}`).join('\n'))
  const longBox = await wrap.boundingBox()
  if (!longBox) throw new Error('no editor box after typing')

  // The box grows WITH short content (no dead space, matching
  // .rendered's own min-height) but stops growing once it reaches its
  // own bounded ceiling -- 40 lines is far more than the ceiling
  // holds, so an unbounded editor would measure many times taller.
  expect(shortBox.height).toBeLessThan(60)
  expect(longBox.height).toBeLessThan(340)

  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  // Cleanup.
  const menu = contextMenu(page)
  await sticky.click({ button: 'right' })
  await menu.getByText('Delete note', { exact: true }).click()
  await expect(sticky).toHaveCount(0)
})
