import { test, expect } from './fixtures/server'
import { openToolbarAction } from './fixtures/toolbarActions'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { ATLAS_KIND_DOCUMENT } from './fixtures/kindPicker'
import { openCard, createCardViaTray } from './fixtures/atlasBoard'

// Atlas projections (docs/goals/0064, ADR-0038): mirror-content
// rendering, the traceability matrix, and coverage -- each proven
// against the real seed, split out of atlas.spec.ts (architecture.md's
// 500-line convention). That file's own header covers the shared
// egocentric-root auto-entry behavior every test below relies on (the
// board is already "The engagement"'s content on landing, no "The engagement"
// click needed). One-map board (goal 0072 slice A): a card overlay
// opens via the click model's select-then-commit (goal 0102); a card
// holding cards ("Client records") drills via its own region-frame
// header, not a card-body click.

// Precise per-card matching: aria-label carries the exact title.
function noteCard(page: import('@playwright/test').Page, title: string) {
  return page.locator(`[data-testid="atlas-note-card"][aria-label="Open ${title}"]`)
}

function groupCard(page: import('@playwright/test').Page, title: string) {
  return page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator(`[aria-label="Zoom into ${title}"]`) })
}

test('a card with a Mirror path pointing at a markdown file renders its content read-only in the overlay', async ({ page }) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-atlas-mirror-'))
  const file = path.join(dir, 'notes.md')
  fs.writeFileSync(file, '# Field notes\n\nSome **captured** text.')

  const title = 'ZzE2eAtlasMirrorCard'
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await createCardViaTray(page, title, { kindID: ATLAS_KIND_DOCUMENT })

  const newCard = noteCard(page, title)
  await expect(newCard).toBeVisible()
  await openCard(page, newCard)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()

  // The calm page renders an empty mirror path as a quiet-add line;
  // the input only mounts (focused) after expanding it.
  await overlay.getByTestId('atlas-page-add-mirror-path').click()
  await overlay.getByTestId('atlas-page-mirror-path').fill(file)
  await overlay.getByTestId('atlas-page-mirror-path').blur()
  await expect(overlay.getByTestId('atlas-page-saved-tick')).toBeVisible()

  await page.keyboard.press('Escape')
  await openCard(page, newCard)
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-mirror-markdown')).toBeVisible()
  await expect(overlay.getByTestId('atlas-mirror-markdown')).toContainText('Field notes')
  await expect(overlay.getByTestId('atlas-mirror-markdown').locator('strong')).toContainText('captured')
  // Regression (goal 0162): the mirror preview keeps its read-only
  // document chrome -- an outer border and a heading underline --
  // after the note field's own rendering split off this shared class.
  const mirror = overlay.getByTestId('atlas-mirror-markdown')
  await expect(mirror).toHaveCSS('border-top-width', '1px')
  const heading = mirror.locator('h1')
  await expect(heading).toHaveCSS('border-bottom-width', '1px')

  // Cleanup (testing.md's within-file cleanup discipline).
  await deleteViaPageMenu(page, overlay)
  await expect(newCard).not.toBeVisible()
})

test('the traceability matrix pivots a space\'s cards by kind against link kinds, with an absent cell shown explicitly', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')

  await openToolbarAction(page, 'atlas-open-matrix')
  const dialog = page.locator('[data-component="atlas-matrix-dialog"]')
  await expect(dialog).toBeVisible()

  // Row kind "Contact" -- the seeded "Jordan Reyes" card has an
  // outgoing "relates to" link to "Statement of work", so its cell names
  // that target.
  await dialog.getByTestId('atlas-matrix-row-kind').selectOption({ label: '👤 Contact' })
  await expect(dialog.getByTestId('atlas-matrix-target').filter({ hasText: 'Statement of work' })).toBeVisible()

  // Row kind "Document" -- the seeded "Statement of work" card has no
  // OUTGOING links of its own (only an incoming one), so its cell is
  // explicitly absent, never an ambiguous blank.
  await dialog.getByTestId('atlas-matrix-row-kind').selectOption({ label: '📄 Document' })
  await expect(dialog.getByTestId('atlas-matrix-absent-cell')).toBeVisible()
  await expect(dialog.getByTestId('atlas-matrix-absent-cell')).toHaveText('None')

  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
})

test('the roadmap swimlanes a space\'s cards by kind against horizon tags, with an untagged card falling to Unscheduled', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')

  await openToolbarAction(page, 'atlas-open-roadmap')
  const dialog = page.locator('[data-component="atlas-roadmap-dialog"]')
  await expect(dialog).toBeVisible()

  await expect(dialog.getByTestId('atlas-roadmap-column-header')).toHaveText(['Now', 'Next', 'Then', 'Unscheduled'])
  await expect(dialog.getByTestId('atlas-roadmap-lane-label').filter({ hasText: 'Contact' })).toBeVisible()
  await expect(dialog.getByTestId('atlas-roadmap-lane-label').filter({ hasText: 'Document' })).toBeVisible()

  // The seeded "Jordan Reyes" (Contact) card is tagged "Now"; the seeded
  // "Statement of work" (Document) card carries no horizon tag, so it
  // falls to the trailing Unscheduled column -- both lanes' other three
  // cells render an honest placeholder, never blank.
  await expect(dialog.getByTestId('atlas-roadmap-chip').filter({ hasText: 'Jordan Reyes' })).toBeVisible()
  await expect(dialog.getByTestId('atlas-roadmap-chip').filter({ hasText: 'Statement of work' })).toBeVisible()
  await expect(dialog.getByTestId('atlas-roadmap-empty-cell')).toHaveCount(6)

  await dialog.getByTestId('atlas-roadmap-chip').filter({ hasText: 'Jordan Reyes' }).click()
  await expect(dialog).not.toBeVisible()
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Jordan Reyes')
  await page.keyboard.press('Escape')
})

test('coverage counts a space\'s cards missing a link and missing a mirror, with the missing list navigating to a card', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // "The engagement" has four seeded children: "Discovery workstream" (an
  // outgoing "relates to" link to "Jordan Reyes"), "Client records",
  // "Scratchpad", and "Board gallery" (goal 0223's seeded board-object
  // examples nest here rather than rendering at root) -- a
  // hand-countable 1/4 linked. None carries a mirror directly at THIS
  // level (the seeded mirror lives one level deeper, on "Statement of
  // work") -- a hand-countable 0/4 mirrored.
  await openToolbarAction(page, 'atlas-open-coverage')
  const dialog = page.locator('[data-component="atlas-coverage-dialog"]')
  await expect(dialog).toBeVisible()

  await expect(dialog.getByTestId('atlas-coverage-link-value')).toHaveText('1/4 linked')
  await expect(dialog.getByTestId('atlas-coverage-mirror-value')).toHaveText('0/4 mirrored')

  await dialog.getByTestId('atlas-coverage-link-toggle').click()
  await expect(dialog.getByTestId('atlas-coverage-missing-item').filter({ hasText: 'Client records' })).toBeVisible()
  await expect(dialog.getByTestId('atlas-coverage-missing-item').filter({ hasText: 'Scratchpad' })).toBeVisible()
  await expect(dialog.getByTestId('atlas-coverage-missing-item').filter({ hasText: 'Board gallery' })).toBeVisible()

  await dialog.getByTestId('atlas-coverage-mirror-toggle').click()
  const missingItem = dialog.getByTestId('atlas-coverage-missing-item').filter({ hasText: 'Discovery workstream' })
  await expect(missingItem).toBeVisible()
  await missingItem.click()

  await expect(dialog).not.toBeVisible()
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Discovery workstream')
  await page.keyboard.press('Escape')
})
