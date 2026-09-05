import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './fixtures/server'
import { dragResizeHandle, nonSeededBoardObjects, openCard } from './fixtures/atlasBoard'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { contextMenu } from './fixtures/contextMenu'
import { ATLAS_KIND_TOPIC, selectKind } from './fixtures/kindPicker'

// The image tool (goal 0169 slice 2, re-pointed by goal 0179 S1's own
// correction, and goal 0206's own affordance fix): a native file picker
// (fixtures/server.ts's own MILL_TEST_IMAGE_PICK_PATH bypass -- every
// worker's server returns the "logo.png" fixture below, matching real
// PickImageFile's return shape without a display) or a pasted clipboard
// image lands as a board-local BoardObject -- NEVER a card. The rule,
// absolute: dropping/drawing something on the canvas creates THAT
// THING, never a card. Becoming a card is the explicit, one-way
// "Promote to card…" action proven at the end of the first test;
// atlas-paste-convert.spec.ts and the unit registry's own tests cover
// the renderer, not this file. Shared pool: every entity created here
// is deleted here. The one case needing the real host pasteboard
// (a window-level ⌘V of a screenshot bitmap, which must prove the door
// asks the REAL pasteboard for file paths first) lives in its own
// dedicated-server file, atlas-image-tool-host-paste.spec.ts (goal
// 0356) -- the standard per-worker pool defaults to the in-memory
// clipboard adapter and has no per-spec override.

// A minimal valid 1x1 PNG, inlined rather than read from disk -- the
// paste path never touches the filesystem until SaveImageBytes writes
// it server-side, so the test only needs real bytes of the right type.
const ONE_PIXEL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

async function openImagePopover(page: import('@playwright/test').Page) {
  await page.getByTestId('atlas-tray-image').click()
  await expect(page.getByTestId('atlas-image-input')).toBeVisible()
}

function imageObjects(page: import('@playwright/test').Page) {
  return nonSeededBoardObjects(page, 'image')
}

test('picking an image via the native file dialog lands a board object, never a card -- Promote to card is the explicit escape hatch', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await openImagePopover(page)
  await page.getByTestId('atlas-image-pick').click()

  const object = imageObjects(page)
  await expect(object).toHaveCount(1)
  // Goal 0179 closing gap 2: a picked image actually renders on the
  // board, not just an empty titled box -- a real <img> confirms the
  // mirrored bytes loaded.
  await expect(object.locator('img')).toBeVisible()
  // The rule, absolute: nothing turned into a card the user didn't ask for.
  await expect(page.getByTestId('atlas-note-card').filter({ hasText: 'logo' })).toHaveCount(0)
  // dragBand (goal 0206): an image's whole body already drags, so the
  // shared 'atlas-object' renderer's chrome band never renders for it.
  await expect(object.getByTestId('atlas-board-object-frame')).toHaveCount(0)

  // Promote to card (explicit, reversible-only-by-undo): the SAME
  // mirrored file becomes a real mirror-image card.
  await object.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Promote to card…', { exact: true }).click()
  const popover = page.getByTestId('atlas-placement-popover')
  await expect(popover).toBeVisible()
  await selectKind(popover, ATLAS_KIND_TOPIC)
  await popover.getByTestId('atlas-placement-submit').click()
  await expect(popover).not.toBeVisible()

  await expect(object).toHaveCount(0)
  const card = page.getByTestId('atlas-note-card').filter({ hasText: 'logo' })
  await expect(card).toBeVisible()
  await expect(card.getByText('IMG')).toBeVisible()
  // Goal 0179 closing gap 2: the promoted card shows its image on the
  // board face itself (AtlasUnitMirrorImageFace via the mirror-image
  // unit's Face loader) -- never only once opened.
  await expect(card.locator('img')).toBeVisible()

  await openCard(page, card)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay.getByTestId('atlas-mirror-image')).toBeVisible()
  await deleteViaPageMenu(page, overlay)
  await expect(card).not.toBeVisible()
})

test('pasting a clipboard image lands a board object -- selectable, draggable, deletable with undo', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await openImagePopover(page)
  await page.getByTestId('atlas-image-paste-zone').evaluate((el, base64) => {
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const file = new File([bytes], 'clipboard-image.png', { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, ONE_PIXEL_PNG_BASE64)

  const object = imageObjects(page)
  await expect(object).toHaveCount(1)
  // Goal 0179 closing gap 2: same render proof as the pick-file test.
  await expect(object.locator('img')).toBeVisible()
  // The rule, absolute: nothing turned into a card the user didn't ask
  // for -- checked against a title this paste would have produced had
  // it (wrongly) landed as a card, not a blanket zero (the seeded
  // example space already carries its own cards).
  await expect(page.getByTestId('atlas-note-card').filter({ hasText: 'Pasted image' })).toHaveCount(0)
  // The popover closes itself once the paste resolves -- no further click needed.
  await expect(page.getByTestId('atlas-image-input')).not.toBeVisible()

  // Selectable + deletable, inheriting the shared quick-delete-with-undo
  // guard (goal 0093) every other Atlas delete already rides.
  await object.click()
  await page.keyboard.press('Delete')
  await expect(object).toHaveCount(0)
  const undoToast = page.getByTestId('atlas-undo-toast')
  await expect(undoToast).toBeVisible()
  await expect(undoToast).toContainText('Deleted 1')
  await undoToast.getByTestId('atlas-undo-toast-button').click()
  await expect(undoToast).toHaveCount(0)
  await expect(object).toHaveCount(1)

  await object.click()
  await page.keyboard.press('Delete')
  await expect(object).toHaveCount(0)
})

// Regression: the paste zone answered only bitmap clipboard data -- a
// pasted image-file PATH (plain text) was silently ignored, and the
// board's window-level paste door acting on the same event could land
// a second copy. The zone now routes image-shaped text through the
// same server-side recognizer the board door uses (mirror-copy), and
// marks the event handled so exactly ONE object lands.
test('pasting an image file path as text lands a board object rendering that file', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-atlas-image-paste-path-'))
  const pngPath = path.join(dir, 'ZzE2ePastedPath.png')
  fs.writeFileSync(pngPath, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'))
  try {
    await page.goto('/')
    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(page.getByTestId('atlas-board')).toBeVisible()

    await openImagePopover(page)
    // Same dispatched-ClipboardEvent escape hatch as the bitmap-paste
    // test above: no user primitive can place arbitrary text on the
    // real OS clipboard portably in this harness, and the dispatched
    // event carries the exact DataTransfer shape a real ⌘V delivers.
    await page.getByTestId('atlas-image-paste-zone').evaluate((el, p) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', p)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, pngPath)

    const object = imageObjects(page)
    await expect(object).toHaveCount(1)
    // The object renders the file found at the pasted path -- a real
    // <img> confirms the bytes loaded, not just a titled box.
    await expect(object.locator('img')).toBeVisible()
    // The popover closes itself once the paste resolves.
    await expect(page.getByTestId('atlas-image-input')).not.toBeVisible()
    // The rule, absolute: never a card.
    await expect(page.getByTestId('atlas-note-card').filter({ hasText: 'ZzE2ePastedPath' })).toHaveCount(0)

    await object.click()
    await page.keyboard.press('Delete')
    await expect(object).toHaveCount(0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// Note (goal 0206): the prior "a non-image path shows an inline error"
// case tested typing an arbitrary bad path into a free-text field --
// that field no longer exists (replaced by the native picker, which
// filters to image extensions itself). The extension re-check
// AtlasImageInput.tsx still runs after a pick (windowing.PickImageFile's
// own doc comment: the OS filter is display-only on some platforms) is
// exercised at the unit layer (IMAGE_EXTENSIONS/extensionOf already have
// their own vitest coverage) rather than a dedicated e2e server here --
// reaching a picker-returned bad extension in this harness would need a
// second per-file MILL_TEST_IMAGE_PICK_PATH value, which the shared
// worker pool's one-fixture-per-server model can't give a single test
// without spawning its own dedicated server for one edge case.

// Regression (goal 0199 part B): NodeResizer was rendered by exactly
// one component (AtlasTableCardNode) -- image/ink board objects had a
// Size field and a SetBoardObjectSize call with no handle to reach
// either. Proves the SAME resizer path table's own test proves,
// against a Kind whose content is a plain <img> rather than a grid.
test('an image object can be resized by its own handle, and the size persists across reload', async ({ page }) => {
  // Same CI-invisible drag synthesis this repo's other resize-drag
  // tests already document (QUARANTINE.md atlas-table-resize).
  test.skip(!!process.env.CI, 'drag synthesis coalesces on CI -- QUARANTINE.md atlas-table-resize')
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await openImagePopover(page)
  await page.getByTestId('atlas-image-pick').click()
  const object = imageObjects(page)
  await expect(object).toHaveCount(1)

  const before = await object.boundingBox()
  if (!before) throw new Error('no image object box')

  await object.click()
  const handle = page.locator('.react-flow__resize-control.handle.top.right')
  await expect(handle).toBeVisible()
  await dragResizeHandle(page, handle, 120, -60)

  await expect.poll(async () => (await object.boundingBox())?.width ?? 0).toBeGreaterThan(before.width + 80)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  const reloaded = imageObjects(page)
  await expect(reloaded).toBeVisible()
  await expect.poll(async () => (await reloaded.boundingBox())?.width ?? 0).toBeGreaterThan(before.width + 80)

  await reloaded.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(reloaded).toHaveCount(0)
})
