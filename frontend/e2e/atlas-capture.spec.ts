import { test, expect } from './fixtures/server'
import type { Page } from '@playwright/test'
import { clickCorner, zoomAllTheWayOut } from './fixtures/atlasBoard'
import { openCardPageEdit } from './fixtures/atlasPage'

// Atlas capture doors (goal 0081 slice A3, LOCKED design §2b/§3b):
// paste (text/HTML into the placement popover) and the Scratchpad
// seed rework, driven end to end against the seeded "My space" space
// (internal/domain/atlas/builtin.go) via the standard per-worker
// server fixture (testing.md's own default, unlike atlas-authoring.
// spec.ts's dedicated-server exact-count needs).
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

test('paste text opens the placement popover prefilled with title and note', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const pasted = 'Q3 migration checklist\n\nFinish the vendor review before rollout.'
  await dispatchPaste(page, { text: pasted })

  const popover = page.getByTestId('atlas-placement-popover')
  await expect(popover).toBeVisible()
  await expect(popover.getByTestId('atlas-placement-title')).toHaveValue('Q3 migration checklist')

  await popover.getByTestId('atlas-placement-submit').click()
  await expect(popover).not.toBeVisible()

  const card = page.locator('[data-testid="atlas-note-card"]').filter({ hasText: 'Q3 migration checklist' })
  await expect(card).toBeVisible()
  // The full pasted text became the card's own Note field, rendered
  // directly on its front face -- not just the derived title.
  await expect(card).toContainText('Finish the vendor review before rollout.')

  // Cleanup (testing.md's within-file/within-worker discipline).
  await card.click()
  await expect(card).toHaveAttribute('data-flipped', 'true')
  await card.getByTestId('atlas-note-open').click()
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await openCardPageEdit(page)
  await overlay.getByTestId('atlas-overlay-delete').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(overlay).not.toBeVisible()
})

test('paste HTML converts to Markdown before prefilling the popover', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await dispatchPaste(page, { html: '<h1>Vendor policy</h1><p>Prod credentials never stay with the requester.</p>' })

  const popover = page.getByTestId('atlas-placement-popover')
  await expect(popover).toBeVisible()
  // The title comes from the FIRST LINE of the converted Markdown, not
  // the raw HTML -- "# Vendor policy", trimmed of the heading marker
  // by the same first-line rule paste-as-plain-text uses.
  await expect(popover.getByTestId('atlas-placement-title')).toHaveValue(/Vendor policy/)

  await popover.getByTestId('atlas-placement-submit').click()
  await expect(popover).not.toBeVisible()

  const card = page.locator('[data-testid="atlas-note-card"]').filter({ hasText: 'Vendor policy' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Prod credentials never stay with the requester.')

  await card.click()
  await expect(card).toHaveAttribute('data-flipped', 'true')
  await card.getByTestId('atlas-note-open').click()
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await openCardPageEdit(page)
  await overlay.getByTestId('atlas-overlay-delete').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(overlay).not.toBeVisible()
})

test('paste is inert while an editable field has focus', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // Arm the note tool and focus its draft textarea -- a paste landing
  // there must behave like an ordinary browser paste into that field,
  // never open the placement popover on top of it.
  const board = page.getByTestId('atlas-board')
  await zoomAllTheWayOut(page)
  await page.keyboard.press('n')
  await clickCorner(board, 'top-left')
  const draftTextarea = page.getByTestId('atlas-sticky-textarea')
  await expect(draftTextarea).toBeVisible()
  await draftTextarea.focus()

  await dispatchPaste(page, { text: 'should stay in the textarea' })
  await expect(page.getByTestId('atlas-placement-popover')).toHaveCount(0)

  await draftTextarea.blur()
  await expect(draftTextarea).toHaveCount(0)
})

test('Scratchpad seed is a container card with the inbox guidance note', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const scratchpad = page.locator('[data-testid="atlas-note-card"][aria-label="Flip Scratchpad"]')
  await expect(scratchpad).toBeVisible()
  await expect(scratchpad).toContainText('Quick captures land here. Drag notes out to file them, or promote them into cards.')
  // Still an ordinary Topic card structurally (containment is a role
  // every card carries, ADR-0038 Decision 3) -- no children seeded.
  await expect(scratchpad.getByTestId('atlas-note-leaf-chip')).toBeVisible()
})
