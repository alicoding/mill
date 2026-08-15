import { test, expect } from './fixtures/server'

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
