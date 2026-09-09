// The Trash surface (goal 0406 S2): deleting a vault entry moves it to
// Trash rather than destroying it -- the toast names the way there, the
// row shows when it's gone for good, Restore reverses it, Delete
// forever doesn't, and a reference still naming a trashed entry says so
// distinctly from "unrecognized." Shared pool: every entry/integration
// here is created and deleted by this spec.
import { test, expect } from './fixtures/server'
import { createSecret, deleteSecret, ensureVault, openSecrets } from './fixtures/secretStore'
import { callBindingViaRPC } from './fixtures/wailsRpc'

const CONFIGURE = 'github.com/alicoding/mill/internal/services/configuresvc.ConfigureService.'

function secretRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="secret"]').filter({ hasText: label })
}

test('deleting a secret moves it to Trash; Show Trash, Restore, and Delete forever all work', async ({ page }) => {
  await page.goto('/')
  await ensureVault(page)
  await openSecrets(page)

  await page.getByTestId('secrets-new').click()
  await page.getByTestId('secret-title-input').fill('ZzE2eTrashRestore')
  await page.getByTestId('secret-password-input').fill('trash-restore-pw')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(secretRow(page, 'ZzE2eTrashRestore')).toBeVisible()

  // --- Delete -> "Moved to Trash" toast -> Show Trash -> the row, with its caption ---
  await secretRow(page, 'ZzE2eTrashRestore').getByTestId('inventory-row-menu').click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('alertdialog', { name: 'Move to Trash?' }).getByRole('button', { name: 'Move to Trash' }).click()
  await expect(secretRow(page, 'ZzE2eTrashRestore')).toHaveCount(0)

  const toast = page.getByTestId('undo-delete-toast')
  await expect(toast).toContainText('Moved to Trash')
  await toast.getByTestId('undo-delete-toast-button').click()

  await expect(page.getByTestId('secrets-section-trash')).toBeVisible()
  const trashRow = page.locator('[data-testid="inventory-row"][data-entity="secret"]').filter({ hasText: 'ZzE2eTrashRestore' })
  await expect(trashRow).toBeVisible()
  await expect(trashRow).toContainText('Deleted')
  await expect(trashRow).toContainText('gone in')

  // --- Restore: back in the vault list ---
  await trashRow.getByTestId('inventory-row-menu').click()
  await page.getByRole('menuitem', { name: 'Restore' }).click()
  await expect(trashRow).toHaveCount(0)
  await page.getByTestId('secrets-section-vault').click()
  await expect(secretRow(page, 'ZzE2eTrashRestore')).toBeVisible()

  // --- Delete again, then Delete forever: gone from Trash too ---
  await secretRow(page, 'ZzE2eTrashRestore').getByTestId('inventory-row-menu').click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('alertdialog', { name: 'Move to Trash?' }).getByRole('button', { name: 'Move to Trash' }).click()
  await page.getByTestId('secrets-section-trash').click()
  const trashRowAgain = page.locator('[data-testid="inventory-row"][data-entity="secret"]').filter({ hasText: 'ZzE2eTrashRestore' })
  await expect(trashRowAgain).toBeVisible()
  await trashRowAgain.getByTestId('inventory-row-menu').click()
  await page.getByRole('menuitem', { name: 'Delete forever' }).click()
  await page.getByRole('alertdialog', { name: 'Delete forever?' }).getByRole('button', { name: 'Delete forever' }).click()
  await expect(trashRowAgain).toHaveCount(0)
})

test('a reference to a trashed entry reads "In Trash. Restore to use." in the picker', async ({ page }) => {
  await page.goto('/')
  const ref = await createSecret(page, 'ZzE2eTrashedReference', 'trashed-ref-pw')

  const created = await callBindingViaRPC<{ ID: string }>(page, CONFIGURE + 'CreateHTTPRequest', [
    'ZzE2eTrashedRefIntegration', 'https://api.example.com', 'GET', '', 'bearer', ref, null, '', null, null, '',
  ])

  await deleteSecret(page, ref)

  await page.getByRole('link', { name: 'Configure' }).click()
  await page.locator('[data-testid="inventory-row"][data-entity="request"]').filter({ hasText: 'ZzE2eTrashedRefIntegration' }).getByText('ZzE2eTrashedRefIntegration', { exact: true }).click()
  await page.getByTestId('summary-edit').click()
  await expect(page.getByTestId('request-secret-picker')).toBeVisible()
  await expect(page.getByTestId('secret-ref-trashed')).toHaveText('In Trash. Restore to use.')

  await callBindingViaRPC(page, CONFIGURE + 'DeleteHTTPRequest', [created.ID])
})

test('bulk Restore of two trashed entries', async ({ page }) => {
  await page.goto('/')
  const refA = await createSecret(page, 'ZzE2eBulkRestoreA', 'bulk-a-pw')
  const refB = await createSecret(page, 'ZzE2eBulkRestoreB', 'bulk-b-pw')
  await deleteSecret(page, refA)
  await deleteSecret(page, refB)

  await openSecrets(page)
  await page.getByTestId('secrets-section-trash').click()
  const rowA = page.locator('[data-testid="inventory-row"][data-entity="secret"]').filter({ hasText: 'ZzE2eBulkRestoreA' })
  const rowB = page.locator('[data-testid="inventory-row"][data-entity="secret"]').filter({ hasText: 'ZzE2eBulkRestoreB' })
  await expect(rowA).toBeVisible()
  await expect(rowB).toBeVisible()

  await rowA.getByTestId('inventory-row-select').click()
  await rowB.getByTestId('inventory-row-select').click()
  await expect(page.getByTestId('selection-bar')).toBeVisible()
  await page.getByTestId('selection-bar-action-list.restoreSelection').click()

  await expect(rowA).toHaveCount(0)
  await expect(rowB).toHaveCount(0)
  await page.getByTestId('secrets-section-vault').click()
  await expect(page.locator('[data-testid="inventory-row"][data-entity="secret"]').filter({ hasText: 'ZzE2eBulkRestoreA' })).toBeVisible()
  await expect(page.locator('[data-testid="inventory-row"][data-entity="secret"]').filter({ hasText: 'ZzE2eBulkRestoreB' })).toBeVisible()

  // Within-file cleanup: delete what this test created, all the way --
  // Trash then Destroy, so no Trashed row survives for the next spec.
  await deleteSecretForever(page, refA)
  await deleteSecretForever(page, refB)
})

// deleteSecretForever moves an entry to Trash then destroys it, so a
// spec's own cleanup never leaves a Trashed row for the next test to
// trip over.
async function deleteSecretForever(page: import('@playwright/test').Page, ref: string) {
  const SECRETS = 'github.com/alicoding/mill/internal/services/secretsvc.SecretService.'
  const id = ref.replace(/^vault:/, '')
  await callBindingViaRPC(page, SECRETS + 'DeleteSecret', [id])
  await callBindingViaRPC(page, SECRETS + 'DestroySecret', [id])
}
