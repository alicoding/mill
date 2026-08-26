import { test, expect } from './fixtures/server'
import { blurSticky, stickyEditor } from './fixtures/codeEditor'
import type { Page } from '@playwright/test'
import { clickCorner, deleteSticky, zoomAllTheWayOut } from './fixtures/atlasBoard'

// Atlas capture doors (goal 0081 slice A3, fallback redesigned by goal
// 0218) and the Scratchpad seed rework, driven end to end against the
// seeded "The engagement" space (internal/domain/atlas/builtin.go) via
// the standard per-worker server fixture (testing.md's own default,
// unlike atlas-authoring.spec.ts's dedicated-server exact-count needs).
//
// The instant single-file/native-OS-drop door (item 1/2/4 of the
// slice) is NOT exercised here: window._wails.handlePlatformFileDrop
// -- the one JS entry point a real native drop and a synthetic one
// would both call -- reaches Wails3's own WindowFilesDropped RPC
// case, which requires the connection's own window to be a real
// *WebviewWindow (confirmed live: "Invalid window call: target window
// is not a WebviewWindow"). Server-mode Playwright's connection is not
// one -- this is a structural gap in Wails3's own server-mode support
// for that one RPC, not something this slice's own code can route
// around. The landing function itself (CreateCardFromFileDrop,
// CreateLinkedFileCard, ResolveFileDropRoute) is proven at the
// service level instead (internal/services/atlassvc/
// atlasservice_filedrop_test.go) -- "the same code path the drop
// calls," per this goal's own fallback instruction. Real native-drop
// delivery is a manual-only desktop-mode check (testing.md's existing
// registry for OS-bound behavior), named here rather than silently
// absent.

// dispatchPaste fires a real 'paste' ClipboardEvent at the document,
// backed by a DataTransfer carrying exactly the MIME types given --
// the same mechanism a real ⌘V delivers, without touching the actual
// OS pasteboard (no clipboardLock needed, testing.md's own rule for
// the real-pasteboard case only).
async function dispatchPaste(page: Page, data: { text?: string; html?: string }): Promise<void> {
  await page.evaluate(({ text, html }) => {
    const dt = new DataTransfer()
    if (text !== undefined) dt.setData('text/plain', text)
    if (html !== undefined) dt.setData('text/html', html)
    const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })
    window.dispatchEvent(evt)
  }, data)
}

test('unrecognized text paste lands a selected sticky note at the pointer, no modal', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const pasted = 'Q3 migration checklist\n\nFinish the vendor review before rollout.'
  await dispatchPaste(page, { text: pasted })

  // No modal at all (goal 0218): the popover never appears for an
  // unrecognized paste.
  await expect(page.getByTestId('atlas-placement-popover')).toHaveCount(0)

  const sticky = page.locator('[data-testid="atlas-sticky-note"]').filter({ hasText: 'Q3 migration checklist' })
  await expect(sticky).toBeVisible()
  await expect(sticky).toContainText('Finish the vendor review before rollout.')
  // Selected on landing, without ever having been clicked.
  const wrapper = page.locator('.react-flow__node.selected').filter({ has: sticky })
  await expect(wrapper).toHaveCount(1)

  await deleteSticky(page, sticky)
})

test('unrecognized HTML paste converts to Markdown and lands a selected sticky note', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await dispatchPaste(page, { html: '<h1>Vendor policy</h1><p>Prod credentials never stay with the requester.</p>' })

  await expect(page.getByTestId('atlas-placement-popover')).toHaveCount(0)

  const sticky = page.locator('[data-testid="atlas-sticky-note"]').filter({ hasText: 'Vendor policy' })
  await expect(sticky).toBeVisible()
  await expect(sticky).toContainText('Prod credentials never stay with the requester.')
  const wrapper = page.locator('.react-flow__node.selected').filter({ has: sticky })
  await expect(wrapper).toHaveCount(1)
  // Goal 0226: the converted markdown must DISPLAY formatted -- a real
  // <h1>, not the heading's text surviving inside a plain line.
  await expect(sticky.locator('h1')).toHaveText('Vendor policy')

  await deleteSticky(page, sticky)
})

test('paste is inert while an editable field has focus', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // Arm the note tool and focus its draft textarea -- a paste landing
  // there must behave like an ordinary browser paste into that field,
  // never create a second note on top of it.
  const board = page.getByTestId('atlas-board')
  await zoomAllTheWayOut(page)
  await page.keyboard.press('n')
  await clickCorner(board, 'top-left')
  const editorContent = page.locator('[data-testid="atlas-sticky-editor"] .cm-content')
  await editorContent.waitFor()
  await editorContent.focus()

  await dispatchPaste(page, { text: 'should stay in the editor' })
  await expect(page.locator('[data-testid="atlas-sticky-note"]').filter({ hasText: 'should stay in the editor' })).toHaveCount(0)

  await blurSticky(page)
  await expect(stickyEditor(page)).toHaveCount(0)
})

test('Scratchpad seed is a container card with the inbox guidance note', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const scratchpad = page.locator('[data-testid="atlas-note-card"][aria-label="Open Scratchpad"]')
  await expect(scratchpad).toBeVisible()
  await expect(scratchpad).toContainText('Meeting notes and quick captures land here. Drag them out to file, or promote into cards.')
  // Still an ordinary Topic card structurally (containment is a role
  // every card carries, ADR-0038 Decision 3) -- no children seeded.
  await expect(scratchpad.getByTestId('atlas-note-leaf-chip')).toBeVisible()
})
