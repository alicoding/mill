import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import { callBindingViaRPC } from './fixtures/wailsRpc'

const CONFIGURE = 'github.com/alicoding/mill/internal/services/configuresvc.ConfigureService.'

// The ExecEnv form's maturity fixes, caught from a live owner
// screenshot (docs/SPEC.md §6 / docs/adr/0026): the Profile-mode
// caption must describe the SELECTED mode (it was a static Clean
// description shown under a Login selection -- the UI describing a
// state that isn't real, §1's thesis), and environment variables are
// paired key/value rows that round-trip through the stored KEY=VALUE
// wire shape. Each test deletes what it creates (shared-store
// discipline, .claude/rules/testing.md).

async function openExecEnvTab(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Execution Environments', exact: true }).click()
}

test('Profile-mode caption follows the selected mode', async ({ page }) => {
  await openExecEnvTab(page)
  await page.getByTestId('new-execenv').click()

  const caption = page.getByTestId('execenv-profile-caption')
  await expect(caption).toContainText('Fail-safe default')

  await page.getByLabel('Profile mode').selectOption('login')
  await expect(caption).toContainText('login startup files')
  await expect(caption).not.toContainText('Fail-safe default')

  await page.getByLabel('Profile mode').selectOption('clean')
  await expect(caption).toContainText('Fail-safe default')
})

test('Env variables edit as key/value rows and round-trip through save', async ({ page }) => {
  await openExecEnvTab(page)
  await page.getByTestId('new-execenv').click()

  await page.getByLabel('Label').fill('E2E kv env')
  // A fresh environment has no variables, so its rows sit behind the closed Advanced disclosure.
  await page.getByTestId('execenv-advanced-summary').click()
  await page.getByTestId('execenv-env-key').first().fill('MILL_E2E_FLAG')
  await page.getByTestId('execenv-env-value').first().fill('on=really')
  await page.getByRole('button', { name: 'Save environment' }).click()

  const row = page
    .locator('[data-testid="inventory-row"][data-entity="execenv"]')
    .filter({ has: page.getByText('E2E kv env', { exact: true }) })
  await expect(row).toBeVisible()
  await row.click()

  // Split at the FIRST '=' only -- the value's own '=' survives.
  await expect(page.getByTestId('execenv-env-key').first()).toHaveValue('MILL_E2E_FLAG')
  await expect(page.getByTestId('execenv-env-value').first()).toHaveValue('on=really')
  await page.getByRole('button', { name: 'Cancel' }).click()

  await clickRowAction(page, row, 'Delete')
  await expect(row).not.toBeVisible()
})


test('a shell can borrow a shared environment\'s variables, and the reference survives a save', async ({ page }) => {
  // goal 0306 S5: the variables live in one place and several shells
  // can point at them, so the field has to persist a real reference
  // rather than copying values in.
  await openExecEnvTab(page)
  const environment = await callBindingViaRPC<{ ID: string; Label: string }>(page, CONFIGURE + 'CreateEnvironment', ['ZzE2eShellStage', [{ Key: 'API_BASE', Value: 'https://stage.example.test', Secret: false }]])
  // Reopen so the picker lists the environment created a moment ago.
  await page.reload()
  await page.getByRole('tab', { name: 'Execution Environments', exact: true }).click()
  await page.getByTestId('new-execenv').click()
  await page.getByLabel('Label').fill('E2E borrowing env')
  await page.getByTestId('execenv-advanced-summary').click()
  await page.getByTestId('entity-ref-field').last().selectOption(environment.ID)
  await page.getByRole('button', { name: 'Save environment' }).click()

  const row = page
    .locator('[data-testid="inventory-row"][data-entity="execenv"]')
    .filter({ has: page.getByText('E2E borrowing env', { exact: true }) })
  await expect(row).toBeVisible()
  await row.click()
  await expect(page.getByTestId('entity-ref-field').last()).toHaveValue(environment.ID)
  await page.getByRole('button', { name: 'Cancel' }).click()

  await clickRowAction(page, row, 'Delete')
  await expect(row).not.toBeVisible()
  await callBindingViaRPC(page, CONFIGURE + 'DeleteEnvironment', [environment.ID])
})
