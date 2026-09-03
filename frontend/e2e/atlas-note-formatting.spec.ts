import { test, expect } from './fixtures/server'
import { deleteSticky } from './fixtures/atlasBoard'
import { placeNoteClear } from './fixtures/atlasEmptyRegion'
import { blurSticky, fillSticky, stickyEditor } from './fixtures/codeEditor'

// The note editor's formatting affordances (split out of
// atlas-note-markdown.spec.ts along the 500-line seam): the floating
// selection toolbar (goal 0253) and the line-start to-do shortcut +
// unchecked Enter-continuation (goal 0254). Shared worker pool: every
// note created here is deleted here.

// Regression (goal 0253): the formatting toolbar used to mount INSIDE
// the note node (Crepe's default TooltipProvider parent), where the
// node's box clipped it to nothing -- reproduced live as "element in
// the DOM, zero bounding box". It now floats at body level through the
// same provider's own `root` option: a real on-screen box, outside the
// selected text it acts on, and its buttons apply without ending the
// edit session (the sticky's outside-press commit excludes it).
test('selecting note text shows the floating toolbar outside the text, and Bold round-trips into the committed note', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await placeNoteClear(page, board)
  await expect(stickyEditor(page)).toBeVisible()
  await fillSticky(page, 'Quarterly review meeting notes')
  // ControlOrMeta: select-all is Ctrl+A on the Linux CI runner and
  // Cmd+A locally -- Meta alone selects nothing on Linux, leaving the
  // toolbar honestly hidden.
  await page.keyboard.press('ControlOrMeta+a')

  const toolbar = page.getByTestId('milkdown-selection-toolbar')
  await expect(toolbar).toBeVisible()
  const toolbarBox = await toolbar.boundingBox()
  if (!toolbarBox) throw new Error('toolbar has no bounding box')
  expect(toolbarBox.width).toBeGreaterThan(40)

  // Never covering the text it acts on: the toolbar's box must not
  // intersect the selected text's own rect (floating-ui places it
  // above/below the selection with an offset).
  const selRect = await page.evaluate(() => {
    const range = window.getSelection()?.getRangeAt(0)
    const r = range?.getBoundingClientRect()
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
  })
  if (!selRect) throw new Error('no live selection rect')
  const overlaps = !(
    toolbarBox.x + toolbarBox.width <= selRect.x ||
    selRect.x + selRect.width <= toolbarBox.x ||
    toolbarBox.y + toolbarBox.height <= selRect.y ||
    selRect.y + selRect.height <= toolbarBox.y
  )
  expect(overlaps, 'the toolbar must not cover the selected text').toBe(false)

  // Bold applies from the toolbar WITHOUT ending the edit session,
  // and survives the commit: the resting note renders a real <strong>.
  await page.getByTestId('milkdown-toolbar-bold').click()
  await expect(page.getByTestId('milkdown-toolbar-bold')).toHaveAttribute('aria-pressed', 'true')
  await blurSticky(page)
  const note = page.getByTestId('atlas-sticky-note').filter({ hasText: 'Quarterly review meeting notes' })
  await expect(note.locator('strong')).toHaveText('Quarterly review meeting notes')
  await expect(toolbar).not.toBeVisible()

  await deleteSticky(page, note)
})

// Regression (goal 0253 follow-up): in the full-size note overlay the
// toolbar rendered UNDER the Dialog -- its body-level element sat at a
// z-index below the Primer portal root's, so it existed with
// data-show=true yet the dialog surface painted over it and swallowed
// its clicks. Pinned by hit-testing the toolbar's own center, not just
// visibility (Playwright "visible" was true throughout the bug). Also
// pinned: a toolbar press must not END the overlay's edit session --
// MarkdownNoteField's outside-press commit excludes the body-level
// toolbar the same way the sticky's does.
test('the full-size note overlay shows the toolbar above the dialog, and Bold applies without ending the edit', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await placeNoteClear(page, board)
  await expect(stickyEditor(page)).toBeVisible()
  await fillSticky(page, 'Overlay formatting target')
  await blurSticky(page)
  const note = page.getByTestId('atlas-sticky-note').filter({ hasText: 'Overlay formatting target' })
  await expect(note).toBeVisible()

  await note.click({ modifiers: ['Meta'] })
  const overlay = page.locator('[data-component="atlas-note-overlay"]')
  await expect(overlay).toBeVisible()
  await page.getByTestId('atlas-note-overlay-editor-rendered').click()
  const editor = page.getByTestId('atlas-note-overlay-editor')
  await expect(editor).toBeVisible()
  // The engine mounts async (lazy chunk): the field's own focus hop
  // can fire before the contenteditable exists, so acquire focus the
  // user's way -- click the text itself -- before selecting.
  const editable = editor.locator('[contenteditable="true"]')
  await editable.click()
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('contenteditable') === 'true'))
    .toBe(true)
  await page.keyboard.press('ControlOrMeta+a')

  const toolbar = page.getByTestId('milkdown-selection-toolbar')
  await expect(toolbar).toBeVisible()
  // The regression's own observable: the topmost element at the
  // toolbar's center must be the toolbar itself, not the dialog.
  await expect
    .poll(() => page.evaluate(() => {
      const tb = document.querySelector('[data-testid="milkdown-selection-toolbar"]')
      if (!tb) return 'no-toolbar'
      const r = tb.getBoundingClientRect()
      const under = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return under && tb.contains(under) ? 'toolbar-on-top' : 'buried'
    }))
    .toBe('toolbar-on-top')

  // Bold from the toolbar: applies, and the edit session SURVIVES the
  // press (the editor stays mounted instead of committing closed).
  await page.getByTestId('milkdown-toolbar-bold').click()
  await expect(page.getByTestId('milkdown-toolbar-bold')).toHaveAttribute('aria-pressed', 'true')
  await expect(editor).toBeVisible()
  await expect(editor.locator('strong')).toHaveText('Overlay formatting target')

  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()
  await expect(note.locator('strong')).toHaveText('Overlay formatting target')

  await deleteSticky(page, note)
})

// Regression (goal 0254): typing `[x] `/`[ ] `/`[] ` at the START of
// a plain note line creates a to-do -- the engine's own task rule
// only fires inside an existing list item, so the converged
// line-start convention did nothing (and the two-step `- ` path was
// the only, undiscoverable, way in). Also pinned: Enter at the end of
// a checked to-do continues UNCHECKED (the engine's split inherits
// checked: true; every converged to-do surface starts the next item
// unchecked). Caret-settle guards as in the task test above: each
// conversion/split relocates the caret asynchronously.
test('typing [x] at a line start creates a checked to-do, Enter continues unchecked, and both survive commit', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await placeNoteClear(page, board)
  await expect(stickyEditor(page)).toBeVisible()
  const editable = stickyEditor(page).locator('[contenteditable="true"]')
  // The engine mounts async (lazy chunk + focus hop): a keystroke
  // fired before real focus lands is silently dropped -- poll the one
  // observable (activeElement) before the first character.
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('contenteditable') === 'true'))
    .toBe(true)

  // Settled = the caret sits in a list item AND that item's DOM node
  // is the SAME element across two consecutive polls -- a conversion
  // or attr flip remounts the item's checkbox widget asynchronously,
  // and keystrokes fired mid-remount are dropped (the engine trait the
  // stock task test above documents with its own recovery loop).
  const caretSettledInListItem = () =>
    expect
      .poll(() => page.evaluate(() => {
        const anchor = document.getSelection()?.anchorNode
        const el = anchor instanceof Element ? anchor : anchor?.parentElement
        const li = el?.closest('li')
        if (!li) return 'no-li'
        const w = window as unknown as { __liSettleRef?: Element }
        const prev = w.__liSettleRef
        w.__liSettleRef = li
        return prev === li ? 'stable' : 'changed'
      }))
      .toBe('stable')

  // The item TEXT is inserted atomically (goal 0296's register: the
  // list-item widget remounts asynchronously after a conversion and a
  // per-keystroke sequence can lose its trailing key mid-remount --
  // measured under 4x throttle as "buy mil"; a retype-recovery loop
  // then landed the retyped text in a NEW item, the second unchecked
  // item the flake reported). The conversion keystrokes themselves
  // stay real: they are what this test is about.
  const typeIntoItem = async (text: string) => {
    await page.keyboard.insertText(text)
    await expect(editable).toContainText(text)
  }

  await page.keyboard.type('[x] ', { delay: 40 })
  await expect(editable.locator('.milkdown-icon.label.checked')).toHaveCount(1)
  await caretSettledInListItem()
  await typeIntoItem('buy milk')

  // Enter continues as an UNCHECKED to-do (the converged convention;
  // the raw engine split inherits checked: true) -- so the next line
  // is just typed, no brackets needed. Settle first: an Enter fired
  // while the caret is mid-relocation bypasses the task-aware split.
  await caretSettledInListItem()
  await page.keyboard.press('Enter')
  await expect(editable.locator('.milkdown-icon.label.unchecked')).toHaveCount(1)
  await caretSettledInListItem()
  await typeIntoItem('call the bank')

  await expect(editable).toContainText('buy milk')
  await expect(editable).toContainText('call the bank')
  await expect(editable).not.toContainText('[')

  await blurSticky(page)
  const note = page.getByTestId('atlas-sticky-note').filter({ hasText: 'buy milk' })
  await expect(note.locator('.milkdown-icon.label.checked')).toHaveCount(1)
  await expect(note.locator('.milkdown-icon.label.unchecked')).toHaveCount(1)
  await expect(note).not.toContainText('[')

  await deleteSticky(page, note)
})
