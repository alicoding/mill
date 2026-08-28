import { test, expect } from './fixtures/server'
import { clickCorner, deleteSticky } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'
import { fillMilkdown, fillSticky, stickyEditor, blurSticky } from './fixtures/codeEditor'

// Markdown sticky notes (goal 0145; the editor became a markdown-
// canonical WYSIWYG -- Milkdown -- in goal 0244 S3, ADR-0046): the N
// tool's note is a real markdown surface, rendered by the SAME engine
// edit and rest both mount -- no raw source is ever shown in either
// state, and no server round-trip renders it (the old RenderNoteMarkdown
// RPC). Shared worker pool: every entity this file creates is deleted
// before the test ends.
//
// Contract change from goal 0226 (flagged per goal 0244 S3's brief): a
// WYSIWYG editor CANONICALIZES markdown by construction (it round-trips
// SEMANTICALLY -- same rendered structure -- not byte-for-byte). The
// tests below assert that weaker, still-real property: edit -> commit
// -> reload renders the SAME structure, never a byte-identical source
// string.

// Collects every AtlasService RPC method name the page calls, via the
// same /wails/runtime endpoint the real frontend runtime and this
// suite's own direct-call specs (atlas-frame-note-preview.spec.ts) both
// use -- the one place to prove a specific RPC never fires, rather than
// asserting an absence that could just mean "didn't look".
function trackRPCCalls(page: import('@playwright/test').Page): string[] {
  const calls: string[] = []
  page.on('request', (req) => {
    if (!req.url().includes('/wails/runtime')) return
    const body = req.postData()
    if (!body) return
    try {
      const methodName = JSON.parse(body)?.args?.methodName
      if (typeof methodName === 'string') calls.push(methodName.split('.').pop() ?? methodName)
    } catch {
      // Non-JSON body -- not an RPC call this suite cares about.
    }
  })
  return calls
}

test('sticky notes render markdown via Milkdown; live formatting, a checkbox toggle, and no server round-trip', async ({ page }) => {
  const rpcCalls = trackRPCCalls(page)

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await page.keyboard.press('n')
  await clickCorner(board, 'top-left')
  await expect(stickyEditor(page)).toBeVisible()

  // Real user primitives (testing.md): type each line, no synthetic
  // events -- Milkdown's own input rules convert `#`/`**x**`/`- [ ] `
  // as they're typed, the same way a real person's keystrokes would.
  const editable = stickyEditor(page).locator('[contenteditable="true"]')
  await editable.click()
  await page.keyboard.type('# Plan')
  await page.keyboard.press('Enter')
  await page.keyboard.type('some ')
  await page.keyboard.type('**bold**')
  await page.keyboard.press('Enter')
  // One continuous type() call, not two: a real typist's keystrokes for
  // "- [ ] first task" are one unbroken stream, and splitting it across
  // two separate .type() calls was measured live to occasionally race
  // with the list/task-item transaction the "- [ ] " prefix triggers,
  // scrambling the following characters.
  await page.keyboard.type('- [ ] first task')

  // Live formatting WHILE editing: real elements, never raw syntax --
  // the editor IS the rendered view, no separate source-vs-rendered
  // mode (goal 0244 S3's own design contract).
  await expect(editable.locator('h1')).toHaveText('Plan')
  await expect(editable.locator('strong')).toHaveText('bold')
  await expect(editable).not.toContainText('#Plan')
  await expect(editable).not.toContainText('**bold**')

  // Toggle the checkbox by clicking it (a real pointer primitive) --
  // Milkdown's task-list checkbox is its own clickable icon widget, not
  // a native <input type="checkbox"> (verified live: zero <input> in
  // the mount).
  const checkboxIcon = editable.locator('.milkdown-icon.label').first()
  await expect(checkboxIcon).toHaveClass(/unchecked/)
  await checkboxIcon.click()
  await expect(checkboxIcon).toHaveClass(/\bchecked\b/)

  await blurSticky(page)
  await expect(stickyEditor(page)).toHaveCount(0)

  // At rest: the SAME formatted structure, still no raw syntax, still
  // client-side (Milkdown renders it directly -- no RenderNoteMarkdown
  // round-trip, asserted below).
  const sticky = page.getByTestId('atlas-sticky-note')
  await expect(sticky.locator('h1')).toHaveText('Plan')
  await expect(sticky.locator('strong')).toHaveText('bold')
  const restIcon = sticky.locator('.milkdown-icon.label').first()
  await expect(restIcon).toHaveClass(/\bchecked\b/)
  await expect(sticky).not.toContainText('# Plan')
  await expect(sticky).not.toContainText('**bold**')
  await expect(sticky).not.toContainText('[x] first task')
  await expect(sticky).not.toContainText('[ ]')

  expect(rpcCalls).not.toContain('RenderNoteMarkdown')

  // Regression: a REAL double-click enters edit -- the second press
  // used to beat the selection snapshot's re-render and no-op.
  await page.keyboard.press('Escape')
  await sticky.dblclick()
  await expect(stickyEditor(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(stickyEditor(page)).toHaveCount(0)

  // The big surface (goal 0154): ⌘-click opens the note overlay; the
  // same markdown machinery renders/edits there too.
  await sticky.click({ modifiers: ['Meta'] })
  const overlay = page.locator('[data-component="atlas-note-overlay"]')
  await expect(overlay).toBeVisible()
  // Scoped to the field's own rendered mount, not the whole overlay --
  // the Dialog's own title ("Note") is ALSO an <h1>, so a bare
  // overlay.locator('h1') resolves to two elements.
  const overlayRendered = page.getByTestId('atlas-note-overlay-editor-rendered')
  await expect(overlayRendered.locator('h1')).toHaveText('Plan')
  await expect(overlayRendered.locator('.milkdown-icon.label').first()).toHaveClass(/\bchecked\b/)

  // Regression (goal 0162): the rendered note reads as prose you can
  // click into, not a bordered read-only document -- no border, a
  // text cursor, and a hover background shift, and a real click opens
  // the editor.
  await expect(overlayRendered).toHaveCSS('border-top-width', '0px')
  await expect(overlayRendered).toHaveCSS('cursor', 'text')
  const restBackground = await overlayRendered.evaluate((el) => getComputedStyle(el).backgroundColor)
  await overlayRendered.hover()
  await expect.poll(() => overlayRendered.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(restBackground)
  await overlayRendered.click()
  await expect(page.getByTestId('atlas-note-overlay-editor')).toBeVisible()

  await fillMilkdown(page, 'atlas-note-overlay-editor', '# Plan v2')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()
  await expect(sticky.locator('h1')).toHaveText('Plan v2')

  // Cleanup (testing.md's within-file discipline).
  const menu = contextMenu(page)
  await sticky.click({ button: 'right' })
  await menu.getByText('Delete note', { exact: true }).click()
  await expect(sticky).toHaveCount(0)
})

// Regression (goal 0193's no-auto-resize rule, goal 0199's own
// correction): the note overlay's markdown editor grew its own box
// with every typed line -- the shared field's own mount, unbounded, is
// fixed at MarkdownNoteField (its own header comment carries the full
// finding). Measures the rendered box itself, never anything wrap-
// dependent (CI's font stack differs from local -- #402's own lesson).
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
  // The BOUNDED box, not MilkdownEditor's own inner wrapper -- that
  // inner element keeps its full unclipped intrinsic height by design
  // (MarkdownNoteField.tsx's own comment on -wrap explains why); the
  // outer .editorWrap is what actually stops growing.
  const wrap = page.getByTestId('atlas-note-overlay-editor-wrap')

  const shortBox = await wrap.boundingBox()
  if (!shortBox) throw new Error('no editor box')

  await fillMilkdown(page, 'atlas-note-overlay-editor', Array.from({ length: 40 }, (_, i) => `Line number ${i}`).join('\n'))
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

// Regression (goal 0247, the canvas-note trim): the sticky is a short
// canvas note, not a document editor -- the CodeMirror code-block
// widget (language picker, Copy button, line gutter) and the block
// drag-handle feature never mount here (milkdownCore's NOTE_FEATURES).
// A fenced code block still renders its content as a plain monospace
// block, in both the editing mount and the rest render.
test('a fenced code block renders as a plain block -- no language picker, no Copy button, no drag handles', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await page.keyboard.press('n')
  await clickCorner(board, 'top-left')
  await expect(stickyEditor(page)).toBeVisible()

  const editable = stickyEditor(page).locator('[contenteditable="true"]')
  await editable.click()
  await page.keyboard.type('```js')
  await page.keyboard.press('Enter')
  await page.keyboard.type('console.log(1)')

  // Content lands as a plain <pre>/<code>, not the CodeMirror widget.
  await expect(editable.locator('pre code')).toHaveText('console.log(1)')
  await expect(editable.locator('.language-button')).toHaveCount(0)
  await expect(editable.locator('.copy-button')).toHaveCount(0)
  await expect(editable.locator('.milkdown-block-handle')).toHaveCount(0)

  await blurSticky(page)
  const sticky = page.getByTestId('atlas-sticky-note')
  await expect(sticky.locator('pre code')).toHaveText('console.log(1)')
  await expect(sticky.locator('.language-button')).toHaveCount(0)
  await expect(sticky.locator('.copy-button')).toHaveCount(0)
  await expect(sticky.locator('.milkdown-block-handle')).toHaveCount(0)

  // Cleanup.
  const menu = contextMenu(page)
  await sticky.click({ button: 'right' })
  await menu.getByText('Delete note', { exact: true }).click()
  await expect(sticky).toHaveCount(0)
})

// Regression (goal 0247, defect_class markdown-round-trip-corruption):
// CommonMark's INDENTED code-block rule (a line starting with 4
// spaces/a tab) silently swallowed an entire line into a code block --
// including a real heading, reproduced live via Milkdown's own
// always-on Tab-indent shortcut (4 literal spaces) pressed at a
// paragraph's start before typing "# text". milkdownCore's
// disableIndentedCodeBlock (a `$remark` plugin disabling micromark's
// `codeIndented` construct) means incidental leading whitespace never
// promotes a line into a code block, across a real reload.
test('leading whitespace never swallows a line into a code block across reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await page.keyboard.press('n')
  await clickCorner(board, 'top-right')
  await expect(stickyEditor(page)).toBeVisible()

  const editable = stickyEditor(page).locator('[contenteditable="true"]')
  await editable.click()
  await page.keyboard.press('Tab')
  await page.keyboard.type('# ddka')
  await blurSticky(page)

  const sticky = page.locator('[data-testid="atlas-sticky-note"]').filter({ hasText: 'ddka' })
  await expect(sticky).toBeVisible()
  await expect(sticky.locator('pre')).toHaveCount(0)

  // The actual persistence round-trip -- a fresh Milkdown parse of the
  // saved Note.Text is where the corruption bug actually surfaced.
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  const stickyAfterReload = page.locator('[data-testid="atlas-sticky-note"]').filter({ hasText: 'ddka' })
  await expect(stickyAfterReload).toBeVisible()
  await expect(stickyAfterReload.locator('pre')).toHaveCount(0)

  await deleteSticky(page, stickyAfterReload)
})

// Goal 0226 (interim contract, superseded by goal 0244 S3's canonical-
// not-byte-exact contract, see this file's own header): edit and
// display must agree -- display renders the same markdown structure
// the editor holds. Three heading levels plus a list and bold, checked
// across an edit session AND a page reload -- the reload is the actual
// persistence round-trip proof (Note.Text saved server-side, re-parsed
// by a fresh Milkdown mount on load), never just a re-render of state
// already in memory.
const MARKDOWN_SOURCE = ['# Hello World', '## test', '### hello', '', 'Some **bold** and a list:', '- one', '- two']

async function assertNoteRendersMarkdownSource(sticky: import('@playwright/test').Locator) {
  await expect(sticky.locator('h1')).toHaveText('Hello World')
  await expect(sticky.locator('h2')).toHaveText('test')
  await expect(sticky.locator('h3')).toHaveText('hello')
  await expect(sticky.locator('strong')).toHaveText('bold')
  await expect(sticky.locator('li')).toHaveCount(2)
}

test('a note holding markdown renders real elements, keeps the edit surface inside its own box, and round-trips semantically across a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await page.keyboard.press('n')
  await clickCorner(board, 'top-right')
  await expect(stickyEditor(page)).toBeVisible()
  const editable = stickyEditor(page).locator('[contenteditable="true"]')
  await editable.click()
  for (let i = 0; i < MARKDOWN_SOURCE.length; i++) {
    if (MARKDOWN_SOURCE[i]) await page.keyboard.type(MARKDOWN_SOURCE[i])
    if (i < MARKDOWN_SOURCE.length - 1) await page.keyboard.press('Enter')
  }

  const sticky = page.locator('[data-testid="atlas-sticky-note"]').filter({ hasText: 'Hello World' })
  await expect(sticky).toBeVisible()

  // Display state renders the markdown it stores: real heading
  // elements at three levels, a real list, real bold -- not text that
  // merely survives inside plain lines.
  await assertNoteRendersMarkdownSource(sticky)

  // Edit state: the mount stays inside the node bounds. Probe a point
  // just below the note's own persisted box -- before goal 0226's fix,
  // the unclamped editor painted real content there; it must resolve
  // to nothing from the editor now.
  const selectedWrapper = page.locator('.react-flow__node.selected').filter({ has: sticky })
  if (await selectedWrapper.count() === 0) await sticky.click()
  await sticky.click()
  await expect(stickyEditor(page)).toBeVisible()

  const stickyBox = await sticky.boundingBox()
  if (!stickyBox) throw new Error('sticky has no bounding box')
  const spillsPastBounds = await page.evaluate(({ x, y }) => {
    return !!document.elementFromPoint(x, y)?.closest('.milkdown')
  }, { x: stickyBox.x + 10, y: stickyBox.y + stickyBox.height + 15 })
  expect(spillsPastBounds).toBe(false)

  // Commit unchanged -> display identical.
  await blurSticky(page)
  await assertNoteRendersMarkdownSource(sticky)

  // The actual persistence round-trip: reload re-fetches Note.Text from
  // the server and mounts a FRESH Milkdown instance against it -- the
  // semantic-round-trip property this goal's contract change is about
  // (structure survives; byte-identical source is no longer the bar).
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  const stickyAfterReload = page.locator('[data-testid="atlas-sticky-note"]').filter({ hasText: 'Hello World' })
  await expect(stickyAfterReload).toBeVisible()
  await assertNoteRendersMarkdownSource(stickyAfterReload)

  await deleteSticky(page, stickyAfterReload)
})
