import { test, expect } from './fixtures/server'
import { clickCorner } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'
import { fillMarkdownNote, fillSticky, stickyEditor, blurSticky } from './fixtures/codeEditor'

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
  // same markdown machinery edits there and commits on blur; the
  // sticky face reflects it after close.
  await sticky.click({ modifiers: ['Meta'] })
  const overlay = page.locator('[data-component="atlas-note-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.locator('li')).toHaveCount(2)
  await fillMarkdownNote(page, 'atlas-note-overlay-editor', '# Plan v2\n\n- first\n- **second**\n- third')
  await overlay.locator('[data-testid="atlas-note-overlay-editor"] .cm-content').first().evaluate((el) => (el as HTMLElement).blur())
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()
  await expect(sticky.locator('li')).toHaveCount(3)

  // Cleanup (testing.md's within-file discipline).
  const menu = contextMenu(page)
  await sticky.click({ button: 'right' })
  await menu.getByText('Delete note', { exact: true }).click()
  await expect(sticky).toHaveCount(0)
})
