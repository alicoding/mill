import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { test, expect } from './fixtures/server'
import { openCard } from './fixtures/atlasBoard'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { contextMenu } from './fixtures/contextMenu'
import { ATLAS_KIND_TOPIC, selectKind } from './fixtures/kindPicker'

// The image tool (goal 0169 slice 2, re-pointed by goal 0179 S1's own
// correction): a typed local path or a pasted clipboard image lands as
// a board-local BoardObject -- NEVER a card. The rule, absolute:
// dropping/drawing something on the canvas creates THAT THING, never a
// card. Becoming a card is the explicit, one-way "Promote to card…"
// action proven at the end of the first test; atlas-paste-convert.spec.ts
// and the unit registry's own tests cover the renderer, not this file.
// Shared pool: every entity created here is deleted here.

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const IMAGE_FIXTURE = path.join(REPO_ROOT, 'e2e', 'fixtures', 'synced-folder', 'logo.png')

// A minimal valid 1x1 PNG, inlined rather than read from disk -- the
// paste path never touches the filesystem until SaveImageBytes writes
// it server-side, so the test only needs real bytes of the right type.
const ONE_PIXEL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

async function openImagePopover(page: import('@playwright/test').Page) {
  await page.getByTestId('atlas-tray-image').click()
  await expect(page.getByTestId('atlas-image-input')).toBeVisible()
}

function imageObjects(page: import('@playwright/test').Page) {
  return page.locator('[data-testid="atlas-board-object"][data-object-kind="image"]')
}

test('typing a local image path lands a board object, never a card -- Promote to card is the explicit escape hatch', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await openImagePopover(page)
  await page.getByTestId('atlas-image-path').fill(IMAGE_FIXTURE)
  await page.getByTestId('atlas-image-add').click()

  const object = imageObjects(page)
  await expect(object).toHaveCount(1)
  // The rule, absolute: nothing turned into a card the user didn't ask for.
  await expect(page.getByTestId('atlas-note-card').filter({ hasText: 'logo' })).toHaveCount(0)

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
  await page.getByTestId('atlas-image-path').evaluate((el, base64) => {
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
  // The rule, absolute: nothing turned into a card the user didn't ask
  // for -- checked against a title this paste would have produced had
  // it (wrongly) landed as a card, not a blanket zero (the seeded
  // example space already carries its own cards).
  await expect(page.getByTestId('atlas-note-card').filter({ hasText: 'Pasted image' })).toHaveCount(0)
  // The popover closes itself once the paste resolves -- no Add click needed.
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

test('a non-image path shows an inline error and creates nothing', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await openImagePopover(page)
  await page.getByTestId('atlas-image-path').fill('/tmp/notes.pdf')
  await page.getByTestId('atlas-image-add').click()

  await expect(page.getByTestId('atlas-image-error')).toBeVisible()
  await expect(imageObjects(page)).toHaveCount(0)
})

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
  await page.getByTestId('atlas-image-path').fill(IMAGE_FIXTURE)
  await page.getByTestId('atlas-image-add').click()
  const object = imageObjects(page)
  await expect(object).toHaveCount(1)

  const before = await object.boundingBox()
  if (!before) throw new Error('no image object box')

  await object.click()
  const handle = page.locator('.react-flow__resize-control.handle.top.right')
  await expect(handle).toBeVisible()
  const hb = await handle.boundingBox()
  if (!hb) throw new Error('no resize handle box')
  const startX = hb.x + hb.width / 2
  const startY = hb.y + hb.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(startX + i * 20, startY - i * 10)
    // Pointer-coalescing class (this repo's other resize-drag tests
    // have the full reasoning) -- each step must land in its own frame.
    await page.waitForTimeout(50)
  }
  await page.mouse.up()

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
