import { expect, test } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import { openSecretSources } from './fixtures/secretStore'
import { openConfigureKind } from './fixtures/configureNav'

// Configure's delete undo across families (goal 0270). Shared pool:
// every entity here is created and deleted by this file. The List case
// lives in view-mode-toggle.spec.ts; this proves a second family and
// the Integration summary's own trash icon ride the same toast.
//
// Every row action here dispatches through the command registry with
// the row's own entity context (goal 0346) -- the two cases below are
// what proves the whole path (row -> commandId + ctx -> registry ->
// service) end to end, not just that a menu item exists.

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


test('a Decision row\'s Duplicate opens a draft prefilled from that row', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Decisions')
  await expect(page.getByTestId('configure-decisions')).toBeVisible()

  await page.getByTestId('new-decision').click()
  await page.getByLabel('Label').fill('ZzE2eDuplicateSource')
  await page.getByTestId('save-decision').click()
  const row = page.locator('[data-testid="inventory-row"][data-entity="decision"]').filter({ hasText: 'ZzE2eDuplicateSource' })
  await expect(row).toBeVisible()

  // Duplicate is configure.decision.duplicate, run with this row's
  // context -- the prefilled "(copy)" label is the registry command's
  // effect arriving in a form it cannot reach directly.
  await clickRowAction(page, row, 'Duplicate')
  await expect(page.getByLabel('Label')).toHaveValue('ZzE2eDuplicateSource (copy)')

  await page.getByTestId('save-decision').click()
  const copy = page.locator('[data-testid="inventory-row"][data-entity="decision"]').filter({ hasText: 'ZzE2eDuplicateSource (copy)' })
  await expect(copy).toBeVisible()

  await clickRowAction(page, copy, 'Delete')
  await expect(copy).toHaveCount(0)
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
})

test('a List row\'s Delete still deletes at once and offers Undo', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Lists')

  await page.getByTestId('new-list').click()
  await page.getByTestId('list-label').fill('ZzE2eUndoList')
  await page.getByTestId('save-list').click()
  await page.getByRole('button', { name: 'Close' }).click()

  const row = page.locator('[data-testid="inventory-row"][data-entity="list"]').filter({ hasText: 'ZzE2eUndoList' })
  await expect(row).toBeVisible()

  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
  const toast = page.getByTestId('undo-delete-toast')
  await expect(toast).toContainText('Deleted "ZzE2eUndoList"')
  await toast.getByTestId('undo-delete-toast-button').click()
  await expect(row).toBeVisible()

  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
})
