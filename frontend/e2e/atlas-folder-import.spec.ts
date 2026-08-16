import { test, expect } from './fixtures/server'

// Synced-folder onboarding (docs/goals/0067) over real Go bindings
// (Wails3 server mode): AtlasService.PickFolder's own MILL_TEST_
// FOLDER_PICK_PATH bypass (wired in fixtures/server.ts) points every
// spawned server at e2e/fixtures/synced-folder/, a small real fixture
// tree (a nested folder, two text-ish files, one image, one hidden
// file) -- clicking "Add from folder..." drives the exact same
// PickFolder -> ScanFolder -> preview -> ImportFolderSuggestions path
// the real desktop app's native dialog would, proving pick, bounded
// scan, partial accept, and mirror rendering end to end. Seeded names
// ("My space") are used to navigate to a real space, same posture
// atlas.spec.ts's own header documents.

test('add from folder: scan, partial accept, containment, and mirror rendering all work end to end', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await page.getByTestId('atlas-shelf-card').filter({ hasText: 'My space' }).click()
  await expect(page.getByTestId('atlas-canvas')).toBeVisible()

  await page.getByTestId('atlas-add-from-folder').click()
  const dialog = page.locator('[data-component="atlas-folder-import-dialog"]')
  await expect(dialog).toBeVisible()

  // Bounded scan found every real, non-hidden entry -- nothing
  // truncated (well under the default caps) and the hidden file never
  // appears anywhere in the preview.
  await expect(page.getByTestId('atlas-folder-import-truncated')).toHaveCount(0)
  await expect(dialog).not.toContainText('.hidden')
  await expect(dialog.getByTestId('atlas-folder-import-group')).toHaveCount(3)

  // Assign each heuristic category to a real, user-chosen Kind --
  // group order is containers, then files, then images.
  const kindSelects = dialog.getByTestId('atlas-folder-import-kind')
  await kindSelects.nth(0).selectOption({ label: '🗂️ Space' })
  await kindSelects.nth(1).selectOption({ label: '📄 Document' })
  await kindSelects.nth(2).selectOption({ label: '📄 Document' })

  // Partial accept: reject "Project Plan" (Project Plan.txt), keep
  // everything else, including the nested Reports/Q1 Summary entry.
  await dialog.getByRole('checkbox', { name: 'Project Plan' }).uncheck()

  const confirmButton = dialog.getByRole('button', { name: 'Add 4 cards' })
  await expect(confirmButton).toBeVisible()
  await confirmButton.click()
  await expect(dialog).not.toBeVisible()

  // The rejected entry never becomes a card; every accepted root-level
  // entry does, under "My space" -- containment for the nested entry
  // is checked separately below.
  await expect(page.getByTestId('atlas-canvas-card').filter({ hasText: 'Project Plan' })).toHaveCount(0)
  const notesCard = page.getByTestId('atlas-canvas-card').filter({ hasText: 'Meeting Notes' })
  const logoCard = page.getByTestId('atlas-canvas-card').filter({ hasText: 'Logo' })
  const reportsCard = page.getByTestId('atlas-canvas-card').filter({ hasText: 'Reports' })
  await expect(notesCard).toBeVisible()
  await expect(logoCard).toBeVisible()
  await expect(reportsCard).toBeVisible()

  // Containment: the nested entry landed INSIDE its own scanned
  // folder's card, not flattened to "My space" -- and its own
  // MirrorPath drives the goal-0064 mirror renderer showing real
  // content, not just a stored path.
  await reportsCard.click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Reports')
  const summaryCard = page.getByTestId('atlas-shelf-card').filter({ hasText: 'Q1 Summary' })
  await expect(summaryCard).toBeVisible()
  await summaryCard.getByTestId('atlas-card-info').click()
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-overlay-mirror-path')).toHaveValue(/Reports\/Q1 Summary\.md$/)
  await expect(overlay.getByTestId('atlas-mirror-markdown')).toContainText('Numbers looked good across the board.')

  // Cleanup (testing.md's within-file/within-worker discipline): the
  // child card must go before its own container can be deleted.
  await overlay.getByTestId('atlas-overlay-delete').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(summaryCard).not.toBeVisible()

  await page.getByTestId('atlas-breadcrumb').getByText('My space', { exact: true }).click()
  for (const card of [reportsCard, notesCard, logoCard]) {
    await card.getByTestId('atlas-card-info').click()
    await expect(overlay).toBeVisible()
    await overlay.getByTestId('atlas-overlay-delete').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
    await expect(overlay).not.toBeVisible()
  }
})

test('add from folder: canceling the picker leaves the space untouched', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await page.getByTestId('atlas-shelf-card').filter({ hasText: 'My space' }).click()

  // The fixture picker path always "succeeds" (it's the env bypass,
  // not a real dialog a user could cancel) -- this proves the OTHER
  // half of consent-first instead: scanning alone writes nothing.
  // Opening then closing the preview via Cancel must leave the space
  // exactly as it was.
  await page.getByTestId('atlas-add-from-folder').click()
  const dialog = page.locator('[data-component="atlas-folder-import-dialog"]')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByTestId('atlas-canvas-card').filter({ hasText: 'Meeting Notes' })).toHaveCount(0)
})
