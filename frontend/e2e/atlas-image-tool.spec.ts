import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { test, expect } from './fixtures/server'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { openCard } from './fixtures/atlasBoard'

// The image tool (goal 0169 slice 2): the paste-or-drop interaction's
// own proof. A typed local path and a pasted clipboard image both land
// a card the EXISTING mirror-image unit renders (ADR-0043) -- this
// spec proves the creation gesture, not the renderer, which
// atlas-paste-convert.spec.ts and the unit registry's own tests
// already cover. Shared pool: every entity created here is deleted
// here.

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

test('typing a local image path lands a card the mirror-image unit renders', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await openImagePopover(page)
  await page.getByTestId('atlas-image-path').fill(IMAGE_FIXTURE)
  await page.getByTestId('atlas-image-add').click()

  const card = page.getByTestId('atlas-note-card').filter({ hasText: 'logo' })
  await expect(card).toBeVisible()
  await expect(card.getByText('IMG')).toBeVisible()

  await openCard(page, card)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay.getByTestId('atlas-mirror-image')).toBeVisible()
  await deleteViaPageMenu(page, overlay)
  await expect(card).not.toBeVisible()
})

test('pasting a clipboard image lands a card without any typed path', async ({ page }) => {
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

  const card = page.getByTestId('atlas-note-card').filter({ hasText: 'Pasted image' })
  await expect(card).toBeVisible()
  await expect(card.getByText('IMG')).toBeVisible()
  // The popover closes itself once the paste resolves -- no Add click needed.
  await expect(page.getByTestId('atlas-image-input')).not.toBeVisible()

  await openCard(page, card)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay.getByTestId('atlas-mirror-image')).toBeVisible()
  await deleteViaPageMenu(page, overlay)
  await expect(card).not.toBeVisible()
})

test('a non-image path shows an inline error and creates nothing', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await openImagePopover(page)
  await page.getByTestId('atlas-image-path').fill('/tmp/notes.pdf')
  await page.getByTestId('atlas-image-add').click()

  await expect(page.getByTestId('atlas-image-error')).toBeVisible()
  // hasText substring-matches the WHOLE card subtree -- the seeded
  // Scratchpad card's own body text ("Meeting notes...") would false-
  // positive a bare hasText: 'notes' filter, so this checks for an
  // exact-text title match instead.
  await expect(page.getByTestId('atlas-note-card').filter({ has: page.getByText('notes', { exact: true }) })).toHaveCount(0)
})
