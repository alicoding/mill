// Secret sources (ADR-0050, goal 0306): a dotenv file on this machine
// becomes a source whose keys appear as secrets -- titles only, the
// value read at use time. Shared pool: the source is created and
// deleted here; the file lives in a temp dir this test owns.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './fixtures/server'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { clickRowAction } from './inventoryRow'

const SECRETS = 'github.com/alicoding/mill/internal/services/secretsvc.SecretService.'

test('a dotenv secret source lists its keys as secrets by title, never a value, and is editable and deletable', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-secret-source-'))
  const envPath = path.join(dir, '.env')
  fs.writeFileSync(envPath, 'API_TOKEN=tok-e2e-123\nOTHER_KEY=x\n')
  try {
    await page.goto('/')
    await page.getByRole('link', { name: 'Configure' }).click()
    await page.getByRole('tab', { name: 'Secret sources', exact: true }).click()
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
    await page.getByRole('link', { name: 'Configure' }).click()
    await page.getByRole('tab', { name: 'Secret sources', exact: true }).click()
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
