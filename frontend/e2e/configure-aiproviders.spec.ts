import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// docs/goals/0031-ai-node-family.md: the AIProvider Configure entity's
// own CRUD surface (ConfigureAIProviders.tsx), the recipe mirrored from
// MCPServer -- create/edit round-trips Kind/BaseURL/Model, and Base
// URL's caption follows the selected Kind (an Anthropic provider needs
// no Base URL at all, same "the UI describes the real selected state"
// bar configure-execenv.spec.ts's Profile-mode caption test already
// sets, docs/SPEC.md §1's thesis). Each test deletes what it creates.

async function openAIProvidersTab(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'AI Providers', exact: true }).click()
}

test('Base URL caption follows the selected Kind', async ({ page }) => {
  await openAIProvidersTab(page)
  await page.getByTestId('new-aiprovider').click()

  await expect(page.getByText('e.g. http://localhost:11434 for local Ollama')).toBeVisible()

  await page.getByTestId('aiprovider-kind').selectOption('anthropic')
  await expect(page.getByText('Leave empty to use the real Anthropic API')).toBeVisible()

  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('Creating, editing, and deleting an OpenAI-compatible AI provider round-trips its fields', async ({ page }) => {
  await openAIProvidersTab(page)
  await page.getByTestId('new-aiprovider').click()

  await page.getByLabel('Label').fill('E2E test provider')
  await page.getByPlaceholder('http://localhost:11434').fill('http://localhost:9999')
  await page.getByPlaceholder('llama3.2').fill('e2e-model')
  await page.getByRole('button', { name: 'Save AI provider' }).click()

  const row = page
    .locator('[data-testid="inventory-row"][data-entity="aiprovider"]')
    .filter({ has: page.getByText('E2E test provider', { exact: true }) })
  await expect(row).toBeVisible()
  await expect(row).toContainText('e2e-model')
  await expect(row).toContainText('http://localhost:9999')

  await row.click()
  await expect(page.getByLabel('Label')).toHaveValue('E2E test provider')
  await expect(page.getByPlaceholder('http://localhost:11434')).toHaveValue('http://localhost:9999')
  // Secret is write-only -- never pre-fills, even though none was set.
  await expect(page.getByLabel('Secret (API key)')).toHaveValue('')

  await page.getByLabel('Label').fill('E2E test provider (edited)')
  await page.getByRole('button', { name: 'Save AI provider' }).click()

  const editedRow = page
    .locator('[data-testid="inventory-row"][data-entity="aiprovider"]')
    .filter({ has: page.getByText('E2E test provider (edited)', { exact: true }) })
  await expect(editedRow).toBeVisible()

  await clickRowAction(page, editedRow, 'Delete')
  await expect(editedRow).not.toBeVisible()
})
