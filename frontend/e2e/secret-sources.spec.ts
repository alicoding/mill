// Secret sources (ADR-0050, goal 0306): a dotenv file on this machine
// becomes a source whose keys appear as secrets -- titles only, the
// value read at use time. Sources live under Secrets, beside the
// entries they feed, not in Configure. Shared pool: the source is
// created and deleted here; the file lives in a temp dir this test
// owns.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './fixtures/server'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { clickRowAction } from './inventoryRow'
import { openSecretSources } from './fixtures/secretStore'

const SECRETS = 'github.com/alicoding/mill/internal/services/secretsvc.SecretService.'



test('a dotenv secret source lists its keys as secrets by title, never a value, and is editable and deletable', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-secret-source-'))
  const envPath = path.join(dir, '.env')
  fs.writeFileSync(envPath, 'API_TOKEN=tok-e2e-123\nOTHER_KEY=x\n')
  try {
    await page.goto('/')
    await openSecretSources(page)
    await expect(page.getByTestId('configure-secretsources')).toBeVisible()

    await page.getByTestId('new-secretsource').click()
    await page.getByTestId('secretsource-label').fill('ZzE2eProjectEnv')
    await page.getByTestId('secretsource-path').fill(envPath)
    await page.getByTestId('save-secretsource').click()
    const row = page.locator('[data-testid="inventory-row"][data-entity="secretsource"]').filter({ hasText: 'ZzE2eProjectEnv' })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Dotenv file')

    // The source's keys are secrets now, by title -- the value never
    // appears anywhere a picker reads.
    const listed = await callBindingViaRPC<{ ID: string; Title: string }[]>(page, SECRETS + 'ListProviderSecrets', [])
    const mine = listed.filter((s) => s.Title.endsWith('— ZzE2eProjectEnv'))
    expect(mine.map((s) => s.Title)).toEqual(['API_TOKEN — ZzE2eProjectEnv', 'OTHER_KEY — ZzE2eProjectEnv'])
    expect(mine[0].ID).toMatch(/^env:[a-z0-9-]+\/API_TOKEN$/)
    expect(JSON.stringify(listed)).not.toContain('tok-e2e-123')

    // Edit the label; the picker titles follow.
    await row.click()
    await page.getByTestId('secretsource-label').fill('ZzE2eProjectEnvRenamed')
    await page.getByTestId('save-secretsource').click()
    await expect(page.locator('[data-testid="inventory-row"][data-entity="secretsource"]').filter({ hasText: 'ZzE2eProjectEnvRenamed' })).toBeVisible()
    await expect.poll(async () => (await callBindingViaRPC<{ Title: string }[]>(page, SECRETS + 'ListProviderSecrets', [])).some((s) => s.Title === 'API_TOKEN — ZzE2eProjectEnvRenamed')).toBe(true)

    // Cleanup through the page's own delete.
    const renamed = page.locator('[data-testid="inventory-row"][data-entity="secretsource"]').filter({ hasText: 'ZzE2eProjectEnvRenamed' })
    await clickRowAction(page, renamed, 'Delete')
    await expect(renamed).toHaveCount(0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a Bruno collection source lists the secrets its environments declare and the .env keys, by the collection\'s name', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-bruno-source-'))
  fs.writeFileSync(path.join(dir, 'bruno.json'), JSON.stringify({ name: 'ZzE2eGazette', version: '1', type: 'collection' }))
  fs.writeFileSync(path.join(dir, '.env'), 'API_TOKEN=tok-e2e-bruno\n')
  fs.mkdirSync(path.join(dir, 'environments'))
  fs.writeFileSync(path.join(dir, 'environments', 'dev.bru'), 'vars:secret [ API_TOKEN, SIGNING_KEY ]\n')
  try {
    await page.goto('/')
    await openSecretSources(page)
    await page.getByTestId('new-secretsource').click()
    await page.getByTestId('secretsource-label').fill('ZzE2eBrunoSource')
    await page.getByTestId('secretsource-kind').selectOption('bruno')
    await page.getByTestId('secretsource-path').fill(dir)
    await page.getByTestId('save-secretsource').click()
    const row = page.locator('[data-testid="inventory-row"][data-entity="secretsource"]').filter({ hasText: 'ZzE2eBrunoSource' })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Bruno collection')

    const listed = await callBindingViaRPC<{ ID: string; Title: string }[]>(page, SECRETS + 'ListProviderSecrets', [])
    const mine = listed.filter((s) => s.Title.endsWith('— ZzE2eGazette'))
    expect(mine.map((s) => s.Title)).toEqual(['API_TOKEN — ZzE2eGazette', 'SIGNING_KEY — ZzE2eGazette'])
    expect(mine[0].ID).toMatch(/^bruno:[a-z0-9-]+\/API_TOKEN$/)
    expect(JSON.stringify(listed)).not.toContain('tok-e2e-bruno')

    await clickRowAction(page, row, 'Delete')
    await expect(row).toHaveCount(0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a 1Password source with no op tool on this machine lists nothing and its row says why', async ({ page }) => {
  await page.goto('/')
  await openSecretSources(page)
  await page.getByTestId('new-secretsource').click()
  await page.getByTestId('secretsource-label').fill('ZzE2eOnePassword')
  await page.getByTestId('secretsource-kind').selectOption('op')
  await expect(page.getByTestId('secretsource-path')).toHaveAttribute('placeholder', 'Vault name (optional)')
  await page.getByTestId('save-secretsource').click()
  const row = page.locator('[data-testid="inventory-row"][data-entity="secretsource"]').filter({ hasText: 'ZzE2eOnePassword' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('1Password')
  // The e2e machine has no op tool: the row states it rather than listing nothing silently.
  await expect(row).toContainText('op is not installed')
  const listed = await callBindingViaRPC<{ Title: string }[]>(page, SECRETS + 'ListProviderSecrets', [])
  expect((listed ?? []).some((s) => s.Title.endsWith('— ZzE2eOnePassword'))).toBe(false)
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
})


// Sources have ONE home. A link to where they used to be redirects
// (shared/viewRedirects.test.ts pins that mapping); what this proves is
// that Configure no longer offers the door at all, so the two can never
// both be true.
test('Configure no longer offers a Secret sources tab', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await expect(page.getByRole('tab', { name: 'Integrations', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Secret sources', exact: true })).toHaveCount(0)
})
