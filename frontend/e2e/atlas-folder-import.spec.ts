import { test, expect } from './fixtures/server'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { clickBreadcrumbSegment, openCard } from './fixtures/atlasBoard'
import { contextMenu } from './fixtures/contextMenu'

// Synced-folder onboarding (docs/goals/0067) over real Go bindings
// (Wails3 server mode): AtlasService.PickFolder's own MILL_TEST_
// FOLDER_PICK_PATH bypass (wired in fixtures/server.ts) points every
// spawned server at e2e/fixtures/synced-folder/, a small real fixture
// tree (a nested folder, two text-ish files, one image, one hidden
// file) -- clicking "Add from folder..." drives the exact same
// PickFolder -> ScanFolder -> preview -> ImportFolderSuggestions path
// the real desktop app's native dialog would, proving pick, bounded
// scan, partial accept, and mirror rendering end to end. Seeded names
// ("The engagement") are used to navigate to a real space, same posture
// atlas.spec.ts's own header documents. The one-map board (goal 0072
// slice A): a scanned folder becomes a card that, once it holds its
// own imported child, renders as a region frame (drilled via its own
// header) -- containment is structural, not a chosen Kind, so the
// container category below assigns the ordinary seeded "Topic" Kind,
// not a dedicated container concept.

// Precise per-card matching: aria-label carries the exact title.
function noteCard(page: import('@playwright/test').Page, title: string) {
  return page.locator(`[data-testid="atlas-note-card"][aria-label="Open ${title}"]`)
}

function groupCard(page: import('@playwright/test').Page, title: string) {
  return page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator(`[aria-label="Zoom into ${title}"]`) })
}

test('add from folder: scan, partial accept, containment, and mirror rendering all work end to end', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  // The single seeded root auto-enters "The engagement" directly.
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
  // entry does, under "The engagement" -- containment for the nested entry
  // is checked separately below. "Reports" now holds its own imported
  // child, so it renders as a region frame, not a plain leaf note.
  await expect(page.getByTestId('atlas-note-card').filter({ hasText: 'Project Plan' })).toHaveCount(0)
  const notesCard = noteCard(page, 'Meeting Notes')
  const logoCard = noteCard(page, 'Logo')
  const reportsFrame = groupCard(page, 'Reports')
  await expect(notesCard).toBeVisible()
  await expect(logoCard).toBeVisible()
  await expect(reportsFrame).toBeVisible()

  // Containment: the nested entry landed INSIDE its own scanned
  // folder's card, not flattened to "The engagement" -- and its own
  // MirrorPath drives the goal-0064 mirror renderer showing real
  // content, not just a stored path.
  await reportsFrame.getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Reports')
  const summaryCard = noteCard(page, 'Q1 Summary')
  await expect(summaryCard).toBeVisible()
  await openCard(page, summaryCard)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-mirror-path')).toHaveValue(/Reports\/Q1 Summary\.md$/)
  await expect(overlay.getByTestId('atlas-mirror-markdown')).toContainText('Numbers looked good across the board.')

  // Mermaid fences render as inline SVG diagrams (goal 0108); a fence
  // that fails to parse keeps its original code block -- the fixture
  // carries one of each, so exactly one diagram and one surviving
  // fence prove both the render and the honest fallback.
  const diagram = overlay.getByTestId('atlas-mermaid-diagram')
  await expect(diagram).toHaveCount(1)
  await expect(diagram.locator('svg')).toBeVisible()
  await expect(overlay.getByTestId('atlas-mirror-markdown').locator('code.language-mermaid')).toHaveCount(1)

  // Cleanup (testing.md's within-file/within-worker discipline): the
  // child card must go before its own container can be deleted. Once
  // "Reports" holds no children, it renders as a plain note card,
  // deleted the same select-then-commit way as every other leaf below.
  await deleteViaPageMenu(page, overlay)
  await expect(summaryCard).not.toBeVisible()

  await clickBreadcrumbSegment(page, page.getByTestId('atlas-breadcrumb').getByText('The engagement', { exact: true }), 'The engagement')
  for (const card of [noteCard(page, 'Reports'), notesCard, logoCard]) {
    await openCard(page, card)
    await expect(overlay).toBeVisible()
    await deleteViaPageMenu(page, overlay)
    await expect(overlay).not.toBeVisible()
  }
})

// The shared fixture folder is committed state (testing.md): rather
// than adding a duplicate-content fixture file, this scenario imports
// one real fixture file, then re-opens the SAME folder's preview --
// its own checksum now matches the card just created, proving goal
// 0088's flag end to end without mutating the fixture tree.
test('add from folder: an already-imported file stays flagged and default-unchecked, but importing it anyway still creates a card', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await page.getByTestId('atlas-add-from-folder').click()
  const dialog = page.locator('[data-component="atlas-folder-import-dialog"]')
  await expect(dialog).toBeVisible()

  // First pass: import only Meeting Notes.md, to keep this scenario's
  // footprint to the one file the duplicate check below needs.
  await dialog.getByRole('checkbox', { name: 'Project Plan' }).uncheck()
  await dialog.getByRole('checkbox', { name: 'Logo' }).uncheck()
  await dialog.getByRole('checkbox', { name: 'Reports' }).uncheck()
  await dialog.getByRole('checkbox', { name: 'Q1 Summary' }).uncheck()
  await dialog.getByRole('button', { name: 'Add 1 cards' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(noteCard(page, 'Meeting Notes')).toBeVisible()

  // Drill into "Client records" (shelves mode, auto-arranged -- no fixed
  // grid slot to collide with "The engagement"'s own first import) before the
  // second pass, so cross-space duplicate matching is what's proven,
  // and the two same-titled cards never land on top of each other.
  await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')

  // Second pass, same folder, different target space: Meeting Notes.md's
  // own content still matches the card created under "The engagement" -- its
  // row must be flagged and default-unchecked, while an unrelated row
  // stays checked.
  await page.getByTestId('atlas-add-from-folder').click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('atlas-folder-import-duplicate')).toHaveText('Already on the map as “Meeting Notes”')
  await expect(dialog.getByRole('checkbox', { name: 'Meeting Notes' })).not.toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Project Plan' })).toBeChecked()

  // Including the flagged row anyway must still create its card -- a
  // duplicate is flagged, never blocked.
  await dialog.getByRole('checkbox', { name: 'Meeting Notes' }).check()
  await dialog.getByRole('checkbox', { name: 'Project Plan' }).uncheck()
  await dialog.getByRole('checkbox', { name: 'Logo' }).uncheck()
  await dialog.getByRole('checkbox', { name: 'Reports' }).uncheck()
  await dialog.getByRole('checkbox', { name: 'Q1 Summary' }).uncheck()
  await dialog.getByRole('button', { name: 'Add 1 cards' }).click()
  await expect(dialog).not.toBeVisible()

  const secondNotesCard = noteCard(page, 'Meeting Notes')
  await expect(secondNotesCard).toBeVisible()

  // Cleanup (testing.md's within-file discipline): delete both cards
  // this scenario created -- the one just made here, then the first
  // one back under "The engagement".
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await openCard(page, secondNotesCard)
  await expect(overlay).toBeVisible()
  await deleteViaPageMenu(page, overlay)
  await expect(overlay).not.toBeVisible()

  await clickBreadcrumbSegment(page, page.getByTestId('atlas-breadcrumb').getByText('The engagement', { exact: true }), 'The engagement')
  const firstNotesCard = noteCard(page, 'Meeting Notes')
  await openCard(page, firstNotesCard)
  await expect(overlay).toBeVisible()
  await deleteViaPageMenu(page, overlay)
  await expect(overlay).not.toBeVisible()
})

// Accepts only "Reports" (container) and its own nested "Q1 Summary.md"
// from the shared fixture folder -- the third scenario this file's
// fixture supports, isolating goal 0178 S2's container-mirror behaviour
// from the other two scenarios' own cleanup.
async function importReportsOnly(page: import('@playwright/test').Page, dialog: import('@playwright/test').Locator) {
  await page.getByTestId('atlas-add-from-folder').click()
  await expect(dialog).toBeVisible()
  const kindSelects = dialog.getByTestId('atlas-folder-import-kind')
  await kindSelects.nth(0).selectOption({ label: '🧭 Topic' })
  await kindSelects.nth(1).selectOption({ label: '📄 Document' })
  await kindSelects.nth(2).selectOption({ label: '📄 Document' })
  await dialog.getByRole('checkbox', { name: 'Meeting Notes' }).uncheck()
  await dialog.getByRole('checkbox', { name: 'Project Plan' }).uncheck()
  await dialog.getByRole('checkbox', { name: 'Logo' }).uncheck()
  // A reimport's own nested file is flagged as an already-mirrored
  // duplicate and defaults unchecked (goal 0088); re-checking it is
  // what proves this second pass actually re-syncs it rather than
  // silently skipping, same as the cross-space duplicate scenario above.
  const summaryCheckbox = dialog.getByRole('checkbox', { name: 'Q1 Summary' })
  if (!(await summaryCheckbox.isChecked())) await summaryCheckbox.check()
  await dialog.getByRole('button', { name: 'Add 2 cards' }).click()
  await expect(dialog).not.toBeVisible()
}

test('add from folder: a nested reimport is idempotent, and a mirrored container shows freshness + Refresh from folder (goal 0178 S2)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const dialog = page.locator('[data-component="atlas-folder-import-dialog"]')
  const menu = contextMenu(page)
  const reportsFrame = groupCard(page, 'Reports')
  const summaryCard = noteCard(page, 'Q1 Summary')

  await importReportsOnly(page, dialog)
  await expect(reportsFrame).toBeVisible()
  await expect(reportsFrame.getByTestId('atlas-group-freshness-dot')).toHaveCount(1)
  await expect(reportsFrame.getByTestId('atlas-group-mirror-missing')).toHaveCount(0)

  // "Refresh from folder" re-syncs without ever showing the picker
  // again -- the honest gesture over re-running the whole import flow.
  await reportsFrame.getByTestId('atlas-group-header').click({ button: 'right' })
  await expect(menu).toBeVisible()
  await expect(menu.getByText('Reveal in file manager', { exact: true })).toBeVisible()
  await menu.getByText('Refresh from folder', { exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(reportsFrame).toBeVisible()
  await expect(reportsFrame.getByTestId('atlas-group-freshness-dot')).toHaveCount(1)

  // A second full reimport of the SAME nested folder into the SAME
  // target merges in place at every level (goal 0178 S1 only reached
  // the root; S2's container MirrorPath is what makes the nested Q1
  // Summary card resolve to the same "Reports" parent both times).
  await importReportsOnly(page, dialog)
  await expect(groupCard(page, 'Reports')).toHaveCount(1)
  await expect(summaryCard).toHaveCount(1)

  // Cleanup (testing.md's within-file discipline): the child card
  // before its own container, same pattern as the first scenario above.
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await openCard(page, summaryCard)
  await expect(overlay).toBeVisible()
  await deleteViaPageMenu(page, overlay)
  await expect(overlay).not.toBeVisible()
  const reportsNote = noteCard(page, 'Reports')
  await openCard(page, reportsNote)
  await expect(overlay).toBeVisible()
  await deleteViaPageMenu(page, overlay)
  await expect(overlay).not.toBeVisible()
})

test('add from folder: canceling the picker leaves the space untouched', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  // The single seeded root auto-enters "The engagement" directly.
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
