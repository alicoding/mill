import { test, expect } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'

// Exercises the Atlas surface (docs/adr/0038, docs/goals/0061 slice B)
// over real Go bindings (Wails3 server mode): the seeded root/My space/
// Example area space proves drill/back, the full-screen overlay, the
// explicit sibling-vs-child create flow, the per-space lens, and Quick
// Panel's card search -- the same seeded-example-is-the-proof pattern
// every other e2e spec in this suite follows. Seeded names ("My space",
// "Example area", "Getting started", "Contact", "Ada Lovelace") are
// used here to assert against the real seed (.claude/rules/testing.md:
// fine in e2e specs, never in frontend/src).

function atlasView(page: import('@playwright/test').Page) {
  return page.getByTestId('atlas-view')
}

test('seeded root renders, drill/back via breadcrumb works across both view modes', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(atlasView(page)).toBeVisible()

  // Root (the virtual top) always renders shelves -- "My space" is the
  // one seeded root-level card, grouped under its own Kind's shelf.
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('All spaces')
  const rootCard = page.getByTestId('atlas-shelf-card').filter({ hasText: 'My space' })
  await expect(rootCard).toBeVisible()

  // Drilling into "My space" (ViewModeCanvas) switches to the React
  // Flow canvas renderer -- its two seeded children ("Example area",
  // "Getting started") render as canvas cards, not shelf rows.
  await rootCard.click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('My space')
  await expect(page.getByTestId('atlas-canvas')).toBeVisible()
  const exampleAreaCard = page.getByTestId('atlas-canvas-card').filter({ hasText: 'Example area' })
  await expect(exampleAreaCard).toBeVisible()

  // Drilling into "Example area" (ViewModeShelves) switches back to
  // shelves -- its seeded children group under their own Kind shelves.
  await exampleAreaCard.click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')
  await expect(page.getByTestId('atlas-shelves')).toBeVisible()
  await expect(page.getByTestId('atlas-shelf-card').filter({ hasText: 'Ada Lovelace' })).toBeVisible()
  await expect(page.getByTestId('atlas-shelf-card').filter({ hasText: 'Project charter' })).toBeVisible()

  // Explicit back: every ancestor crumb is clickable, all the way to root.
  await page.getByTestId('atlas-breadcrumb').getByText('All spaces', { exact: true }).click()
  await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('My space')
  await expect(rootCard).toBeVisible()
})

test('create a child card, edit + persist it via the overlay, then delete it', async ({ page }) => {
  const title = 'ZzE2eAtlasChildCard'
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await page.getByTestId('atlas-shelf-card').filter({ hasText: 'My space' }).click()
  await expect(page.getByTestId('atlas-canvas')).toBeVisible()

  // Sibling-vs-child is always an explicit choice -- "Add inside this
  // card" lands the new card as a CHILD of the currently viewed space.
  await page.getByTestId('atlas-add-button').click()
  await page.getByTestId('atlas-add-child').click()
  await page.getByTestId('atlas-create-kind').selectOption({ label: '🧭 Topic' })
  await page.getByTestId('atlas-create-title').fill(title)
  await page.getByRole('button', { name: 'Create' }).click()

  const newCard = page.getByTestId('atlas-canvas-card').filter({ hasText: title })
  await expect(newCard).toBeVisible()

  // The ⓘ affordance opens the full-screen overlay; editing the note
  // and saving persists it (UpdateCard) -- reopening shows it stuck.
  await newCard.getByTestId('atlas-card-info').click()
  // data-component, not data-testid: Primer's Dialog only forwards its
  // own special-cased "data-component" prop (AtlasCardOverlay.tsx's own
  // comment has the full reasoning).
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await overlay.getByTestId('atlas-overlay-note').fill('A note written by the e2e suite.')
  await overlay.getByTestId('atlas-overlay-save').click()
  await expect(overlay).not.toBeVisible()

  await newCard.getByTestId('atlas-card-info').click()
  await expect(page.getByTestId('atlas-overlay-note')).toHaveValue('A note written by the e2e suite.')

  // Cleanup: delete the card this test created (testing.md's
  // within-file cleanup discipline).
  await page.getByTestId('atlas-overlay-delete').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(newCard).not.toBeVisible()
})

test('the lens hides a kind within a space', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await page.getByTestId('atlas-shelf-card').filter({ hasText: 'My space' }).click()
  await page.getByTestId('atlas-canvas-card').filter({ hasText: 'Example area' }).click()
  await expect(page.getByTestId('atlas-shelves')).toBeVisible()

  const contactCard = page.getByTestId('atlas-shelf-card').filter({ hasText: 'Ada Lovelace' })
  await expect(contactCard).toBeVisible()

  await page.getByTestId('atlas-lens-open').click()
  await expect(page.locator('[data-component="atlas-lens-dialog"]')).toBeVisible()
  await page.getByRole('checkbox', { name: /Contact/ }).uncheck()
  await page.keyboard.press('Escape')

  await expect(contactCard).not.toBeVisible()

  // Restore: re-show the kind so the space's lens doesn't leak into a
  // later test in this same file/worker.
  await page.getByTestId('atlas-lens-open').click()
  await page.getByRole('checkbox', { name: /Contact/ }).check()
  await page.keyboard.press('Escape')
  await expect(contactCard).toBeVisible()
})

test('A sibling card created into a canvas-mode space lands clear of its siblings, not stacked at the origin', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await page.getByTestId('atlas-shelf-card').filter({ hasText: 'My space' }).click()
  await expect(page.getByTestId('atlas-canvas')).toBeVisible()

  // "Example area" (a seeded canvas-mode sibling) already sits at the
  // desired starting position AtlasView.createCard tries first -- a
  // sibling created here must land clear of it (findFreeDropPosition,
  // frontend/src/shared/canvasLayout.ts), not stacked directly on top.
  const exampleAreaCard = page.getByTestId('atlas-canvas-card').filter({ hasText: 'Example area' })
  await expect(exampleAreaCard).toBeVisible()
  await exampleAreaCard.click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')

  const title = 'ZzE2eAtlasSiblingCard'
  await page.getByTestId('atlas-add-button').click()
  await page.getByTestId('atlas-add-sibling').click()
  await page.getByTestId('atlas-create-kind').selectOption({ label: '🧭 Topic' })
  await page.getByTestId('atlas-create-title').fill(title)
  await page.getByRole('button', { name: 'Create' }).click()

  // The new card is a sibling of "Example area" (both live in "My
  // space"), not a child of it -- navigate back up to see them both.
  await page.getByTestId('atlas-breadcrumb').getByText('My space', { exact: true }).click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('My space')
  const newCard = page.getByTestId('atlas-canvas-card').filter({ hasText: title })
  await expect(newCard).toBeVisible()

  const [boxA, boxB] = await Promise.all([exampleAreaCard.boundingBox(), newCard.boundingBox()])
  if (!boxA || !boxB) throw new Error('expected both card bounding boxes to be measurable')
  const overlaps =
    boxA.x < boxB.x + boxB.width && boxA.x + boxA.width > boxB.x && boxA.y < boxB.y + boxB.height && boxA.y + boxA.height > boxB.y
  expect(overlaps).toBe(false)

  // Cleanup (testing.md's within-file discipline).
  await newCard.getByTestId('atlas-card-info').click()
  await page.getByTestId('atlas-overlay-delete').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(newCard).not.toBeVisible()
})

test('Exporting the atlas graph downloads a portable JSON bundle with the seeded content', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(atlasView(page)).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('atlas-export').click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'))

  expect(parsed.schema).toBe('mill://schema/atlas/v1')
  expect(Array.isArray(parsed.cards)).toBe(true)
  expect(parsed.cards.some((c: { title?: string }) => c.title === 'My space')).toBe(true)
})

test('Update now on the seeded mirror card runs its workflow through the normal gate and shows a synced receipt live', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await page.getByTestId('atlas-shelf-card').filter({ hasText: 'My space' }).click()
  await page.getByTestId('atlas-canvas-card').filter({ hasText: 'Example area' }).click()
  await expect(page.getByTestId('atlas-shelves')).toBeVisible()

  const charterCard = page.getByTestId('atlas-shelf-card').filter({ hasText: 'Project charter' })
  await expect(charterCard).toBeVisible()
  await charterCard.getByTestId('atlas-card-info').click()
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-overlay-update-now')).toBeVisible()

  await overlay.getByTestId('atlas-overlay-update-now').click()

  // The card's seeded RefreshWorkflowID (example-child-echo-workflow)
  // is deterministic, no clipboard/network -- it runs to SUCCESS
  // synchronously, so both the receipt run id and its status, and the
  // synced timestamp, appear live without a reload.
  await expect(overlay.getByTestId('atlas-overlay-receipt-run')).toBeVisible()
  await expect(overlay.getByTestId('atlas-overlay-receipt-status')).toContainText('SUCCESS')
  await expect(overlay.getByText(/Last synced/)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()
})

test('the lens depth toggle persists server-side across a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await page.getByTestId('atlas-shelf-card').filter({ hasText: 'My space' }).click()
  await page.getByTestId('atlas-canvas-card').filter({ hasText: 'Example area' }).click()
  await expect(page.getByTestId('atlas-shelves')).toBeVisible()

  await page.getByTestId('atlas-lens-open').click()
  await expect(page.locator('[data-component="atlas-lens-dialog"]')).toBeVisible()
  await page.getByRole('button', { name: 'Peek into children' }).click()
  await page.keyboard.press('Escape')

  await page.reload()
  await expect(atlasView(page)).toBeVisible()
  await page.getByTestId('atlas-shelf-card').filter({ hasText: 'My space' }).click()
  await page.getByTestId('atlas-canvas-card').filter({ hasText: 'Example area' }).click()
  await expect(page.getByTestId('atlas-shelves')).toBeVisible()
  await page.getByTestId('atlas-lens-open').click()
  await expect(page.getByRole('button', { name: 'Peek into children', pressed: true })).toBeVisible()
  await page.keyboard.press('Escape')

  // Restore: clear the peek toggle so it doesn't leak into a later test
  // in this same file/worker (testing.md's within-file cleanup rule).
  await page.getByTestId('atlas-lens-open').click()
  await page.getByRole('button', { name: 'This level only' }).click()
  await page.keyboard.press('Escape')
})

test('Quick Panel finds a seeded Atlas card by title', async ({ page }) => {
  const mainPage = await page.context().newPage()
  try {
    await mainPage.goto('/')
    await mainPage.getByRole('link', { name: 'Atlas' }).click()
    await expect(atlasView(mainPage)).toBeVisible()

    await page.goto('/#/quickpanel')
    const search = page.getByRole('combobox', { name: 'Quick Panel search' })
    await expect(search).toBeFocused()
    await search.fill('Ada Lovelace')

    const option = page.getByRole('option', { name: /Ada Lovelace/ })
    await expect(option).toBeVisible()
  } finally {
    await mainPage.close()
  }
})

// goal 0063's share model -- card overlay/chip + space toolbar share
// actions, proven against the seeded "Project charter" card (has a
// Source URL, a Contact field, and an incoming "relates to" link from
// "Ada Lovelace" -- builtin.go's own worked example) and its parent
// "Example area" space. Real browser clipboard I/O (Playwright's
// clipboard-read/clipboard-write permissions), so every clipboard-
// touching section runs inside withClipboardLock -- same discipline
// quick-panel-clipboard-apply.spec.ts already established for
// navigator.clipboard, not just the Go osascript/pbcopy adapter.
// Deliberately never clicks a reveal-in-Finder action here: it shells
// out to the real OS file manager (BackupService.RevealBackupFolder's
// own mechanism, reused by RevealSpaceFolder/RevealCardMirror), the
// same reason goal 0065's own "Show in Finder" button has no e2e click
// coverage either -- Go-level tests (atlasservice_share_test.go) cover
// that behavior instead; e2e only asserts the action's presence.
async function readClipboardText(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText())
}

// A share action's clipboard write happens after an async AtlasService
// round trip (fire-and-forget from the click handler's own point of
// view), so the clipboard's new content can lag a few ticks behind the
// click that requested it -- poll rather than read once immediately.
async function expectClipboardToContain(page: import('@playwright/test').Page, want: string): Promise<void> {
  await expect.poll(() => readClipboardText(page)).toContain(want)
}

test('the card overlay Share section copies context and the cloud link to the clipboard', async ({ page }) => {
  await withClipboardLock(async () => {
    await page.goto('/')
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('link', { name: 'Atlas' }).click()
    await page.getByTestId('atlas-shelf-card').filter({ hasText: 'My space' }).click()
    await page.getByTestId('atlas-canvas-card').filter({ hasText: 'Example area' }).click()
    await expect(page.getByTestId('atlas-shelves')).toBeVisible()

    const charterCard = page.getByTestId('atlas-shelf-card').filter({ hasText: 'Project charter' })
    await charterCard.getByTestId('atlas-card-info').click()
    const overlay = page.locator('[data-component="atlas-card-overlay"]')
    await expect(overlay).toBeVisible()

    await overlay.getByTestId('atlas-overlay-copy-context').click()
    await expectClipboardToContain(page, 'Project charter')
    const contextText = await readClipboardText(page)
    expect(contextText).toContain('Kind: Document')
    expect(contextText).toContain('Owner: Ada Lovelace')
    expect(contextText).toContain('Source: https://example.com/project-charter')

    await overlay.getByTestId('atlas-overlay-copy-link').click()
    await expect.poll(() => readClipboardText(page)).toBe('https://example.com/project-charter')

    await page.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()
  })
})

test('the card chip Share menu copies as context directly from the space view', async ({ page }) => {
  await withClipboardLock(async () => {
    await page.goto('/')
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('link', { name: 'Atlas' }).click()
    await page.getByTestId('atlas-shelf-card').filter({ hasText: 'My space' }).click()
    await page.getByTestId('atlas-canvas-card').filter({ hasText: 'Example area' }).click()
    await expect(page.getByTestId('atlas-shelves')).toBeVisible()

    const charterCard = page.getByTestId('atlas-shelf-card').filter({ hasText: 'Project charter' })
    await charterCard.getByTestId('atlas-card-share').click()
    await expect(page.getByTestId('atlas-share-copy-context')).toBeVisible()
    await expect(page.getByTestId('atlas-share-copy-context-attachments')).toBeVisible()
    await expect(page.getByTestId('atlas-share-copy-link')).toBeVisible()

    await page.getByTestId('atlas-share-copy-context').click()
    await expectClipboardToContain(page, 'Project charter')
  })
})

test('the space toolbar Share menu bundles the space as context and copies its links', async ({ page }) => {
  await withClipboardLock(async () => {
    await page.goto('/')
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('link', { name: 'Atlas' }).click()
    await page.getByTestId('atlas-shelf-card').filter({ hasText: 'My space' }).click()
    await page.getByTestId('atlas-canvas-card').filter({ hasText: 'Example area' }).click()
    await expect(page.getByTestId('atlas-shelves')).toBeVisible()

    await page.getByTestId('atlas-space-share').click()
    await expect(page.getByTestId('atlas-share-reveal-folder')).toBeVisible()
    await page.getByTestId('atlas-share-bundle-context').click()
    await expectClipboardToContain(page, 'Project charter')
    const bundleText = await readClipboardText(page)
    expect(bundleText).toContain('Ada Lovelace')
    expect(bundleText).toContain('---')

    await page.getByTestId('atlas-space-share').click()
    await page.getByTestId('atlas-share-copy-links').click()
    await expect.poll(() => readClipboardText(page)).toBe('https://example.com/project-charter')
  })
})
