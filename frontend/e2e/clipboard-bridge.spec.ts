import { test, expect } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'
import { noteCard, openCard } from './fixtures/atlasBoard'
import { deleteViaPageMenu } from './fixtures/atlasPage'

// The clipboard bridge (goal 0099): Copy for AI emits the JSON
// envelope; the Quick Panel's clipboard door recognizes a reply,
// renders the review surface (collisions default-unchecked), and the
// accept runs the seeded route workflow. Shared worker pool: every
// entity this file creates it deletes; clipboard sections take the
// cross-process lock per testing.md's real-pasteboard discipline.

async function openPanelWithClipboard(page: import('@playwright/test').Page, payload: string) {
  await page.goto('about:blank')
  await page.goto('/#/quickpanel')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate((t) => navigator.clipboard.writeText(t), payload)
  const search = page.getByRole('combobox', { name: 'Quick Panel search' })
  await expect(search).toBeFocused()
  await search.fill('apply from clipboard')
  const option = page.getByRole('option', { name: 'Apply from clipboard…' })
  await expect(option).toBeVisible()
  await option.click()
}

test('Copy for AI puts the reply-contract envelope on the clipboard', async ({ page }) => {
  await withClipboardLock(async () => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(page.getByTestId('atlas-board')).toBeVisible()
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

    const card = noteCard(page, 'Getting started')
    await openCard(page, card)
    await page.getByTestId('atlas-overlay-copy-for-ai').click()

    // The copy handler's binding round-trip + clipboard write are
    // async relative to the click -- poll until the envelope lands.
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('"mill"')
    const raw = await page.evaluate(() => navigator.clipboard.readText())
    const envelope = JSON.parse(raw)
    expect(envelope.mill).toBe(1)
    expect(envelope.kind).toBe('context')
    expect(envelope.schema.type).toBe('object')
    expect(envelope.allowedActions).toContain('create-cards')
    expect(envelope.items[0].title).toBe('Getting started')
    // Hardened wording (goal 0101 slice 2 item 4): "raw JSON object",
    // never "code block", which invites a fenced answer.
    expect(envelope.instructions).toContain('raw JSON object')
    expect(envelope.instructions).not.toContain('code block')
    await page.keyboard.press('Escape')
  })
})

test('a valid reply reviews with collisions unchecked, and accepting creates only the checked card', async ({ page }) => {
  const freshTitle = 'ZzE2eBridgeCard'
  await withClipboardLock(async () => {
    const reply = JSON.stringify({
      mill: 1, kind: 'reply', action: 'create-cards',
      items: [{ title: 'Getting started' }, { title: freshTitle, note: 'from the reply' }],
    })
    await openPanelWithClipboard(page, reply)

    const review = page.getByTestId('quick-panel-reply-review')
    await expect(review).toBeVisible()
    const checkboxes = review.getByTestId('quick-panel-reply-card-checkbox')
    await expect(checkboxes).toHaveCount(2)
    await expect(checkboxes.nth(0)).not.toBeChecked()
    await expect(checkboxes.nth(1)).toBeChecked()
    await expect(review.getByText(/Already exists as/)).toBeVisible()

    const confirm = review.getByTestId('quick-panel-reply-confirm')
    await expect(confirm).toContainText('Create 1 card')
    await confirm.click()
    await expect(review).toHaveCount(0)
  })

  // The accepted card exists; the declined collision stayed singular.
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  const created = noteCard(page, freshTitle)
  await expect(created).toBeVisible()
  await expect(noteCard(page, 'Getting started')).toHaveCount(1)

  // Cleanup (within-file discipline).
  await openCard(page, created)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await deleteViaPageMenu(page, overlay)
  await expect(created).toHaveCount(0)
})

test('an invalid reply names its failures and Copy corrected context re-emits the contract', async ({ page }) => {
  await withClipboardLock(async () => {
    const bad = JSON.stringify({ mill: 1, kind: 'reply', action: 'create-cards', items: [{ note: 'no title here' }] })
    await openPanelWithClipboard(page, bad)

    const invalid = page.getByTestId('quick-panel-reply-invalid')
    await expect(invalid).toBeVisible()
    await expect(invalid).toContainText('title')

    await invalid.getByTestId('quick-panel-reply-copy-correction').click()
    await expect(invalid.getByTestId('quick-panel-reply-copy-correction')).toContainText('Copied')
    const raw = await page.evaluate(() => navigator.clipboard.readText())
    const envelope = JSON.parse(raw)
    expect(envelope.kind).toBe('context')
    expect(envelope.instructions).toContain('did not validate')
    expect(envelope.schema.properties.action.enum).toContain('create-cards')
  })
})
