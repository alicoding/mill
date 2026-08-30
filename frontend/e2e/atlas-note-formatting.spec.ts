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

  // The same bounded retype-recovery the stock task test above uses:
  // a conversion/flip can remount the item's widget AFTER any settle
  // observable this harness can poll, and keystrokes in that window
  // drop (partially or wholly) -- a real user's recovery is selecting
  // the line and retyping, performed here before the hard assertion.
  const typeIntoItem = async (text: string) => {
    for (let round = 0; round < 4; round++) {
      await page.keyboard.type(text, { delay: 20 })
      try {
        await editable.getByText(text).waitFor({ state: 'visible', timeout: 2_000 })
        return
      } catch {
        // Under load the caret can ESCAPE the item mid-remount, so a
        // blind retype lands in the void -- re-anchor by clicking the
        // item itself, then clear whatever partially landed.
        await editable.locator('li').last().click()
        await page.keyboard.press('End')
        await page.keyboard.press('Shift+Home')
        await page.keyboard.press('Backspace')
      }
    }
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
