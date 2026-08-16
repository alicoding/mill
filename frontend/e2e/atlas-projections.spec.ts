import { test, expect } from './fixtures/server'

// Atlas projections (docs/goals/0064, ADR-0038): mirror-content
// rendering, the traceability matrix, and coverage -- each proven
// against the real seed, split out of atlas.spec.ts (architecture.md's
// 500-line convention). That file's own header covers the shared
// egocentric-root auto-entry behavior every test below relies on (the
// canvas is already "My space"'s content on landing, no "My space"
// click needed).

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
  await expect(page.getByTestId('atlas-canvas')).toBeVisible()

  await page.getByTestId('atlas-add-button').click()
  await page.getByTestId('atlas-add-child').click()
  await page.getByTestId('atlas-create-kind').selectOption({ label: '📄 Document' })
  await page.getByTestId('atlas-create-title').fill(title)
  await page.getByRole('button', { name: 'Create' }).click()

  const newCard = page.getByTestId('atlas-canvas-card').filter({ hasText: title })
  await expect(newCard).toBeVisible()
  await newCard.getByTestId('atlas-card-info').click()
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()

  await overlay.getByTestId('atlas-overlay-mirror-path').fill(file)
  await overlay.getByTestId('atlas-overlay-save').click()
  await expect(overlay).not.toBeVisible()

  await newCard.getByTestId('atlas-card-info').click()
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
  await page.getByTestId('atlas-canvas-card').filter({ hasText: 'Example area' }).click()
  await expect(page.getByTestId('atlas-shelves')).toBeVisible()

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
  await expect(page.getByTestId('atlas-canvas')).toBeVisible()

  // "My space" itself has exactly two seeded children: "Getting
  // started" (has an outgoing "relates to" link to "Ada Lovelace") and
  // "Example area" (the container card itself has no link of its own)
  // -- a hand-countable 1/2 linked. Neither child carries a mirror at
  // THIS level (the seeded mirror lives one level deeper, on "Project
  // charter") -- a hand-countable 0/2 mirrored.
  await page.getByTestId('atlas-open-coverage').click()
  const dialog = page.locator('[data-component="atlas-coverage-dialog"]')
  await expect(dialog).toBeVisible()

  await expect(dialog.getByTestId('atlas-coverage-link-value')).toHaveText('1/2 linked')
  await expect(dialog.getByTestId('atlas-coverage-mirror-value')).toHaveText('0/2 mirrored')

  await dialog.getByTestId('atlas-coverage-link-toggle').click()
  await expect(dialog.getByTestId('atlas-coverage-missing-item').filter({ hasText: 'Example area' })).toBeVisible()

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
