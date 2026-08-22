import { test, expect } from './fixtures/server'

// A note filed in an area is visible from one level up (owner-reported
// gap: cards previewed inside a frame, notes vanished until you
// zoomed in). The structure is built over the runtime wire (the
// established Call.ByName precedent); shared pool -- everything
// created is removed at the end.
test('a note filed in an area shows in the area preview at the parent level', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  const call = async (method: string, args: unknown[]) => {
    const res = await page.request.post('/wails/runtime', {
      headers: { 'x-wails-client-id': 'e2e-frame-note', 'Content-Type': 'application/json' },
      data: { object: 0, method: 0, args: { 'call-id': `fn-${Math.random()}`, methodName: `github.com/alicoding/mill/internal/services/atlassvc.AtlasService.${method}`, args } },
    })
    const text = await res.text()
    if (!res.ok()) throw new Error(`${method} failed: ${res.status()} ${text}`)
    return JSON.parse(text)
  }
  const cards = (await call('Cards', [])) as { ID: string; Title: string; KindID: string }[]
  const spaceID = cards.find((c) => c.Title === 'The engagement')!.ID
  const topicKindID = cards.find((c) => c.Title === 'Discovery workstream')!.KindID
  const frame = await call('CreateCard', [topicKindID, 'ZzNotePreviewArea', '', {}, spaceID, { X: -300, Y: 300 }, '', '', '', '']) as { ID: string }
  await call('CreateCard', [topicKindID, 'ZzNotePreviewKid', '', {}, frame.ID, { X: 10, Y: 10 }, '', '', '', ''])
  const filed = await call('CreateNote', ['ZzFiledNoteText', { X: 40, Y: 40 }, frame.ID]) as { ID: string }
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()

  // Still at the PARENT level: the area preview shows the filed card
  // AND the filed note.
  await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('ZzNotePreviewArea')
  const sticky = page.locator('[data-testid="atlas-sticky-note"]', { hasText: 'ZzFiledNoteText' })
  await expect(sticky).toBeVisible()
  await expect(page.locator('[data-testid="atlas-note-card"]', { hasText: 'ZzNotePreviewKid' })).toBeVisible()

  // Cleanup (within-file discipline): note, kid, frame.
  await call('DeleteNote', [filed.ID])
  const kid = (await call('Cards', []) as { ID: string; Title: string }[]).find((c) => c.Title === 'ZzNotePreviewKid')!
  await call('DeleteCard', [kid.ID])
  await call('DeleteCard', [frame.ID])
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.locator('[data-testid="atlas-group-card"]', { hasText: 'ZzNotePreviewArea' })).toHaveCount(0)
})
