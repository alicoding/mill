import { test, expect } from './fixtures/server'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { openViaFlip } from './fixtures/atlasBoard'

// Split out of atlas.spec.ts (architecture.md's 500-line convention,
// the same split atlas-share.spec.ts/atlas-projections.spec.ts already
// established) once the delete-blast-radius toast case (goal 0103)
// pushed that file over the limit.

// Precise per-card matching, same reasoning as atlas.spec.ts's own
// local copy: a card's own BACK face can legitimately contain another
// card's title in its "<kind> -> <other title>" link row, so aria-label
// carries the exact title instead of a substring match.
function noteCard(page: import('@playwright/test').Page, title: string) {
  return page.locator(`[data-testid="atlas-note-card"][aria-label="Flip ${title}"]`)
}

test('deleting a linked card names the blast radius in the undo toast, and undo restores the link edge', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  await expect(page.locator('.react-flow__edge')).not.toHaveCount(0)

  // "Getting started" carries exactly one seeded link (to "Ada
  // Lovelace") and no children -- the leaf-with-links case.
  const gettingStarted = noteCard(page, 'Getting started')
  await openViaFlip(gettingStarted)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await deleteViaPageMenu(page, overlay)
  await expect(gettingStarted).toHaveCount(0)

  const undoToast = page.getByTestId('atlas-undo-toast')
  await expect(undoToast).toBeVisible()
  await expect(undoToast).toContainText('Deleted 1')
  await expect(undoToast).toContainText('1 link hidden')

  await undoToast.getByTestId('atlas-undo-toast-button').click()
  await expect(undoToast).toHaveCount(0)
  await expect(gettingStarted).toBeVisible()
  await expect(page.locator('.react-flow__edge')).not.toHaveCount(0)
})
