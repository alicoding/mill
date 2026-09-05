import { expect, test } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import { openSecretSources } from './fixtures/secretStore'

// Configure's delete undo across families (goal 0270). Shared pool:
// every entity here is created and deleted by this file. The List case
// lives in view-mode-toggle.spec.ts; this proves a second family and
// the Integration summary's own trash icon ride the same toast.

test('deleting a secret source offers Undo, and undo brings it back with its kind', async ({ page }) => {
  await page.goto('/')
  await openSecretSources(page)
  await page.getByTestId('new-secretsource').click()
  await page.getByTestId('secretsource-label').fill('ZzE2eUndoSource')
  await page.getByTestId('secretsource-kind').selectOption('bw')
  await page.getByTestId('save-secretsource').click()
  const row = page.locator('[data-testid="inventory-row"][data-entity="secretsource"]').filter({ hasText: 'ZzE2eUndoSource' })
  await expect(row).toBeVisible()

  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
  const toast = page.getByTestId('undo-delete-toast')
  await expect(toast).toContainText('Deleted "ZzE2eUndoSource"')
  await toast.getByTestId('undo-delete-toast-button').click()
  await expect(row).toBeVisible()
  await expect(row).toContainText('Bitwarden')
  await expect(toast).toHaveCount(0)

  // A second delete offers its own toast; letting it stand keeps the
  // entity deleted.
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
  await expect(page.getByTestId('undo-delete-toast')).toContainText('ZzE2eUndoSource')
})
