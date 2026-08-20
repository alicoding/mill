import { test, expect } from './fixtures/server'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { ATLAS_KIND_DOCUMENT } from './fixtures/kindPicker'
import { openCard, createCardViaTray } from './fixtures/atlasBoard'
import { noteCard } from './fixtures/atlasCards'

// Recognized sources (goal 0126): a card whose Source host matches a
// configured Integration shows a recognition chip, and workflows
// declaring that Integration (Workflow.OfferOnRequestID) appear as
// offered actions -- runnable without prior attachment; running one
// attaches it. Proven against the SEEDED pieces: the Atlassian example
// integrations ship with host example.invalid, and the seeded
// "Example: Confluence page → Markdown" workflow declares the
// Confluence integration as its offer target.
// Shared worker pool: creates its own card and deletes it.
test('a Source matching a configured Integration offers its declared workflows', async ({ page }) => {
  const title = 'ZzE2eRecognizedSourceCard'
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await createCardViaTray(page, title, { kindID: ATLAS_KIND_DOCUMENT })

  const card = noteCard(page, title)
  await expect(card).toBeVisible()
  await openCard(page, card)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()

  // Give the card a Source on the seeded Atlassian host.
  await overlay.getByTestId('atlas-page-add-source').click()
  await overlay.getByTestId('atlas-page-source').fill('https://example.invalid/wiki/pages/12345')
  await overlay.getByTestId('atlas-page-source').blur()

  // Recognition chip names the matched Integration beside the Source.
  await expect(overlay.getByTestId('atlas-source-recognized')).toBeVisible()

  // The declared workflow appears as an offered action without ever
  // being attached.
  const offers = overlay.getByTestId('atlas-page-offers')
  await expect(offers).toBeVisible()
  const offerRow = offers.getByTestId('atlas-page-offer-row').filter({ hasText: 'Example: Confluence page → Markdown' })
  await expect(offerRow).toBeVisible()

  // Running an offered workflow attaches it: the row moves up into the
  // attached-actions list. (The run itself fails on this machine -- the
  // seeded integration has no credential -- which is fine: attachment
  // and legality are what this asserts; the run error renders as the
  // action row's own error state.)
  await offerRow.getByTestId('atlas-page-run-offer').click()
  const actions = overlay.getByTestId('atlas-page-actions')
  await expect(actions.getByTestId('atlas-page-action-row').filter({ hasText: 'Example: Confluence page → Markdown' })).toBeVisible()
  await expect(offerRow).toHaveCount(0)

  // Cleanup: delete the card so later tests' strict-mode selectors
  // never collide with it.
  await deleteViaPageMenu(page, overlay)
  await expect(card).not.toBeVisible()
})
