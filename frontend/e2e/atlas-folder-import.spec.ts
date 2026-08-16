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
// atlas.spec.ts's own header documents. The one-map board (goal 0072
// slice A): a scanned folder becomes a card that, once it holds its
// own imported child, renders as a region frame (drilled via its own
// header) -- containment is structural, not a chosen Kind, so the
// container category below assigns the ordinary seeded "Topic" Kind,
// not a dedicated container concept.

// Precise per-card matching: a plain hasText substring filter is
// unreliable here since a card's own BACK face can legitimately
// contain another card's title (its own "<kind> -> <other title>"
// link row) -- aria-label carries the exact title instead.
function noteCard(page: import('@playwright/test').Page, title: string) {
  return page.locator(`[data-testid="atlas-note-card"][aria-label="Flip ${title}"]`)
}

function groupCard(page: import('@playwright/test').Page, title: string) {
  return page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator(`[aria-label="Zoom into ${title}"]`) })
}

// Click TOGGLES the flip, so this only clicks when the card is
// currently front-facing -- reopening an already-flipped card must not
// click it back to front first.
async function openViaFlip(card: import('@playwright/test').Locator) {
  if ((await card.getAttribute('data-flipped')) !== 'true') {
    await card.click()
    await expect(card).toHaveAttribute('data-flipped', 'true')
  }
  await card.getByTestId('atlas-note-open').click()
}

test('add from folder: scan, partial accept, containment, and mirror rendering all work end to end', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  // The single seeded root auto-enters "My space" directly.
  await expect(page.getByTestId('atlas-board')).toBeVisible()

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
  // group order is containers, then files, then images. Containment
  // itself has no dedicated Kind (ADR-0038 Decision 3) -- the ordinary
  // seeded "Topic" Kind proves that.
  const kindSelects = dialog.getByTestId('atlas-folder-import-kind')
  await kindSelects.nth(0).selectOption({ label: '🧭 Topic' })
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
  // is checked separately below. "Reports" now holds its own imported
  // child, so it renders as a region frame, not a flippable leaf note.
  await expect(page.getByTestId('atlas-note-card').filter({ hasText: 'Project Plan' })).toHaveCount(0)
  const notesCard = noteCard(page, 'Meeting Notes')
  const logoCard = noteCard(page, 'Logo')
  const reportsFrame = groupCard(page, 'Reports')
  await expect(notesCard).toBeVisible()
  await expect(logoCard).toBeVisible()
  await expect(reportsFrame).toBeVisible()

  // Containment: the nested entry landed INSIDE its own scanned
  // folder's card, not flattened to "My space" -- and its own
  // MirrorPath drives the goal-0064 mirror renderer showing real
  // content, not just a stored path.
  await reportsFrame.getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Reports')
  const summaryCard = noteCard(page, 'Q1 Summary')
  await expect(summaryCard).toBeVisible()
  await openViaFlip(summaryCard)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-overlay-mirror-path')).toHaveValue(/Reports\/Q1 Summary\.md$/)
  await expect(overlay.getByTestId('atlas-mirror-markdown')).toContainText('Numbers looked good across the board.')

  // Cleanup (testing.md's within-file/within-worker discipline): the
  // child card must go before its own container can be deleted. Once
  // "Reports" holds no children, it renders as a plain note card,
  // deleted the same flip-then-Open way as every other leaf below.
  await overlay.getByTestId('atlas-overlay-delete').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(summaryCard).not.toBeVisible()

  await page.getByTestId('atlas-breadcrumb').getByText('My space', { exact: true }).click()
  for (const card of [noteCard(page, 'Reports'), notesCard, logoCard]) {
    await openViaFlip(card)
    await expect(overlay).toBeVisible()
    await overlay.getByTestId('atlas-overlay-delete').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
    await expect(overlay).not.toBeVisible()
  }
})

test('add from folder: canceling the picker leaves the space untouched', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  // The single seeded root auto-enters "My space" directly.
  await expect(page.getByTestId('atlas-board')).toBeVisible()

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
  await expect(noteCard(page, 'Meeting Notes')).toHaveCount(0)
})
