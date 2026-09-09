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
import { ensureVault, openSecretSources, openSecrets } from './fixtures/secretStore'
import { configureKindLink } from './fixtures/configureNav'

const SECRETS = 'github.com/alicoding/mill/internal/services/secretsvc.SecretService.'
const CONFIGURE = 'github.com/alicoding/mill/internal/services/configuresvc.ConfigureService.'



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

// goal 0408 S2: a source key is a secret ENTRY -- same row, same
// actions, plus Copy reference -- grouped under its source in the
// Secrets list itself, not just named on the Sources row.
test('a dotenv source with two keys appears in the Secrets list under the source group -- reveal, copy reference and open source all work', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-secret-source-entries-'))
  const envPath = path.join(dir, '.env')
  fs.writeFileSync(envPath, 'API_TOKEN=tok-e2e-entries-123\nOTHER_KEY=other-e2e-value\n')
  await page.goto('/')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await ensureVault(page)
  const source = await callBindingViaRPC<{ ID: string; Label: string }>(page, CONFIGURE + 'CreateSecretSource', ['ZzE2eEntriesEnv', 'env', envPath])
  try {
    await openSecrets(page)
    const secretRow = (label: string) =>
      page.locator('[data-testid="inventory-row"][data-entity="secret"]').filter({ has: page.getByText(label, { exact: true }) })

    // Both keys are rows, under a group header naming the source.
    await expect(secretRow('API_TOKEN')).toBeVisible()
    await expect(secretRow('OTHER_KEY')).toBeVisible()
    await expect(page.getByTestId(`inventory-group-${source.ID}`)).toContainText(source.Label)

    // Copy reference puts the exact portable string on the clipboard --
    // never the value.
    await clickRowAction(page, secretRow('API_TOKEN'), 'Copy reference')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`env:${source.ID}/API_TOKEN`)

    // Reveal shows the value through the audited resolve. The dialog's
    // own "Access history" opens the SAME filtered view a vault entry's
    // does; what the audit line itself names is checked directly
    // against the record (its filtered row reads as a context sentence,
    // same as any other entry's, per accessHistory.readUiReveal).
    await secretRow('API_TOKEN').getByText('API_TOKEN', { exact: true }).click()
    const detail = page.getByRole('dialog', { name: 'API_TOKEN', exact: true })
    await expect(page.getByTestId('secret-provider-detail-value')).toBeVisible()
    await page.getByLabel('Show password').click()
    await expect(page.getByTestId('secret-provider-detail-value')).toHaveValue('tok-e2e-entries-123')
    await detail.getByRole('button', { name: 'Access history' }).click()
    const history = page.getByRole('dialog', { name: 'Access history for "API_TOKEN"', exact: true })
    await expect(history).toBeVisible()
    await expect(history.getByTestId('secrets-access-history-row').first()).toBeVisible()
    await history.getByLabel('Close').click()

    // The record itself names the source, whatever the filtered view
    // renders it as.
    const access = await callBindingViaRPC<{ records: { entryId: string; label: string; context: string }[] }>(
      page, SECRETS + 'ListSecretAccess', [{ entryId: `env:${source.ID}/API_TOKEN`, actorPrefix: '', limit: 10, offset: 0 }],
    )
    expect(access.records.some((r) => r.label === `API_TOKEN — ${source.Label}` && r.context === 'ui-reveal')).toBe(true)

    // Open source navigates to Sources ▸ that source, in place of
    // the Edit/Delete a vault entry's row menu carries.
    await page.getByRole('button', { name: 'Open source' }).click()
    await expect(page.getByTestId('configure-secretsources')).toBeVisible()
    await expect(page.locator('[data-testid="inventory-row"][data-entity="secretsource"]').filter({ hasText: source.Label })).toBeVisible()
  } finally {
    await callBindingViaRPC(page, CONFIGURE + 'DeleteSecretSource', [source.ID]).catch(() => undefined)
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
  await expect(configureKindLink(page, 'Integrations')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Secret sources', exact: true })).toHaveCount(0)
})
