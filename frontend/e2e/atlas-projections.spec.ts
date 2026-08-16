import { test, expect } from './fixtures/server'

// Atlas projections (docs/goals/0064, ADR-0038): mirror-content
// rendering, the traceability matrix, and coverage -- each proven
// against the real seed, split out of atlas.spec.ts (architecture.md's
// 500-line convention). That file's own header covers the shared
// egocentric-root auto-entry behavior every test below relies on (the
// board is already "My space"'s content on landing, no "My space"
// click needed). One-map board (goal 0072 slice A): a card overlay
// opens by flipping a note card then clicking its back's Open button;
// a card holding cards ("Example area") drills via its own region-
// frame header, not a card-body click.

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
// currently front-facing -- reopening an already-flipped card (e.g. to
// re-check a saved value) must not click it back to front first.
async function openViaFlip(card: import('@playwright/test').Locator) {
  if ((await card.getAttribute('data-flipped')) !== 'true') {
    await card.click()
    await expect(card).toHaveAttribute('data-flipped', 'true')
  }
  await card.getByTestId('atlas-note-open').click()
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

  await page.getByTestId('atlas-add-button').click()
  await page.getByTestId('atlas-add-child').click()
  await page.getByTestId('atlas-create-kind').selectOption({ label: '📄 Document' })
  await page.getByTestId('atlas-create-title').fill(title)
  await page.getByRole('button', { name: 'Create' }).click()

  const newCard = noteCard(page, title)
  await expect(newCard).toBeVisible()
  await openViaFlip(newCard)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()

  await overlay.getByTestId('atlas-overlay-mirror-path').fill(file)
  await overlay.getByTestId('atlas-overlay-save').click()
  await expect(overlay).not.toBeVisible()

  await openViaFlip(newCard)
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-mirror-markdown')).toBeVisible()
  await expect(overlay.getByTestId('atlas-mirror-markdown')).toContainText('Field notes')
  await expect(overlay.getByTestId('atlas-mirror-markdown').locator('strong')).toContainText('captured')

  // Cleanup (testing.md's within-file cleanup discipline).
  await overlay.getByTestId('atlas-overlay-delete').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(newCard).not.toBeVisible()
})

test('the traceability matrix pivots a space\'s cards by kind against link kinds, with an absent cell shown explicitly', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')

  await page.getByTestId('atlas-open-matrix').click()
  const dialog = page.locator('[data-component="atlas-matrix-dialog"]')
  await expect(dialog).toBeVisible()

  // Row kind "Contact" -- the seeded "Ada Lovelace" card has an
  // outgoing "relates to" link to "Project charter", so its cell names
  // that target.
  await dialog.getByTestId('atlas-matrix-row-kind').selectOption({ label: '👤 Contact' })
  await expect(dialog.getByTestId('atlas-matrix-target').filter({ hasText: 'Project charter' })).toBeVisible()

  // Row kind "Document" -- the seeded "Project charter" card has no
  // OUTGOING links of its own (only an incoming one), so its cell is
  // explicitly absent, never an ambiguous blank.
  await dialog.getByTestId('atlas-matrix-row-kind').selectOption({ label: '📄 Document' })
  await expect(dialog.getByTestId('atlas-matrix-absent-cell')).toBeVisible()
  await expect(dialog.getByTestId('atlas-matrix-absent-cell')).toHaveText('None')

  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
})

test('coverage counts a space\'s cards missing a link and missing a mirror, with the missing list navigating to a card', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // "My space" has three seeded children: "Getting started" (an
  // outgoing "relates to" link to "Ada Lovelace"), "Example area" and
  // "Scratchpad" (neither carries a link of its own) -- a hand-
  // countable 1/3 linked. None of the three carries a mirror directly
  // at THIS level (the seeded mirror lives one level deeper, on
  // "Project charter") -- a hand-countable 0/3 mirrored.
  await page.getByTestId('atlas-open-coverage').click()
  const dialog = page.locator('[data-component="atlas-coverage-dialog"]')
  await expect(dialog).toBeVisible()

  await expect(dialog.getByTestId('atlas-coverage-link-value')).toHaveText('1/3 linked')
  await expect(dialog.getByTestId('atlas-coverage-mirror-value')).toHaveText('0/3 mirrored')

  await dialog.getByTestId('atlas-coverage-link-toggle').click()
  await expect(dialog.getByTestId('atlas-coverage-missing-item').filter({ hasText: 'Example area' })).toBeVisible()
  await expect(dialog.getByTestId('atlas-coverage-missing-item').filter({ hasText: 'Scratchpad' })).toBeVisible()

  await dialog.getByTestId('atlas-coverage-mirror-toggle').click()
  const missingItem = dialog.getByTestId('atlas-coverage-missing-item').filter({ hasText: 'Getting started' })
  await expect(missingItem).toBeVisible()
  await missingItem.click()

  await expect(dialog).not.toBeVisible()
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-overlay-title')).toHaveValue('Getting started')
  await page.keyboard.press('Escape')
})
