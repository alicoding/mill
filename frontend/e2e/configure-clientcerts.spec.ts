// Client certificates (goal 0306 S1): the Configure entity naming which
// certificate Mill presents to which host. Shared worker pool: every
// assertion reads only the seeded example and what this file creates
// and deletes itself.
import { test, expect } from './fixtures/server'
import { gotoAppReady } from './fixtures/appReady'
import { createSecret, deleteSecret } from './fixtures/secretStore'
import { clickRowAction } from './inventoryRow'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openConfigureKind } from './fixtures/configureNav'

const rows = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="inventory-row"][data-entity="clientcert"]')

// The shared expandExamples helper waits on the FIRST list-toolbar on
// the page, which belongs to the Configure tab panel rendered before
// this one -- every panel stays mounted, so that one is hidden and the
// wait never resolves. Scoped to this page's own section instead.
async function expandExamplesIn(root: import('@playwright/test').Locator) {
  const toggle = root.getByTestId('inventory-examples-toggle')
  if ((await toggle.count()) === 0) return
  if ((await toggle.first().getAttribute('aria-expanded')) === 'true') return
  await toggle.first().click()
  await expect(toggle.first()).toHaveAttribute('aria-expanded', 'true')
}

async function openCertificates(page: import('@playwright/test').Page) {
  await gotoAppReady(page)
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Certificates')
  const root = page.getByTestId('configure-clientcerts')
  await expect(root).toBeVisible()
  return root
}

// Real material, minted per run rather than committed: the status this
// spec asserts comes from a real decode, and a private key never
// belongs in the repository even when it is a throwaway. openssl is
// present on every machine this suite runs on.
function issueClientPair(): { certPEM: string; keyPEM: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'mill-e2e-clientcert-'))
  try {
    const keyPath = path.join(dir, 'key.pem')
    const certPath = path.join(dir, 'cert.pem')
    const pkcs8Path = path.join(dir, 'key8.pem')
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-keyout', keyPath, '-out', certPath,
      '-days', '3650', '-nodes', '-subj', '/CN=mill-e2e-client',
      '-addext', 'extendedKeyUsage=clientAuth',
    ], { stdio: 'ignore' })
    execFileSync('openssl', ['pkcs8', '-topk8', '-nocrypt', '-in', keyPath, '-out', pkcs8Path], { stdio: 'ignore' })
    return { certPEM: readFileSync(certPath, 'utf8'), keyPEM: readFileSync(pkcs8Path, 'utf8') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the seeded example is listed with its host and an honest status', async ({ page }) => {
  const root = await openCertificates(page)
  await expandExamplesIn(root)
  const seeded = rows(page).filter({ hasText: 'Example: Client certificate for api.example.com' })
  await expect(seeded).toHaveCount(1)
  await expect(seeded).toContainText('api.example.com')
  await expect(seeded).toContainText('Needs a certificate and key')
  await expect(root.getByTestId('new-clientcert')).toBeVisible()
})

test('a certificate is created with pickers filtered by kind, then deleted with Undo', async ({ page }) => {
  const root = await openCertificates(page)
  const { certPEM, keyPEM } = issueClientPair()
  const certRef = await createSecret(page, 'e2e client certificate', certPEM, 'certificate')
  const keyRef = await createSecret(page, 'e2e client key', keyPEM, 'key')
  const tokenRef = await createSecret(page, 'e2e plain token', 'not-a-certificate', 'text')

  await root.getByTestId('new-clientcert').click()
  await root.getByTestId('clientcert-label').fill('E2E payments host')
  await root.getByTestId('clientcert-host').fill('payments.e2e.test')

  // The certificate picker offers certificate and file entries, never a
  // plain token: a field that accepts anything is how a password ends
  // up where a certificate belongs.
  const certPicker = root.getByTestId('clientcert-cert-picker')
  await expect(certPicker.locator('option', { hasText: 'e2e client certificate' })).toHaveCount(1)
  await expect(certPicker.locator('option', { hasText: 'e2e plain token' })).toHaveCount(0)
  await certPicker.selectOption({ label: 'e2e client certificate' })
  await root.getByTestId('clientcert-key-picker').selectOption({ label: 'e2e client key' })
  await root.getByTestId('save-clientcert').click()

  const row = rows(page).filter({ hasText: 'E2E payments host' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('payments.e2e.test')
  // Real material in, so the row reports the certificate it can
  // actually read rather than the "not set up yet" it showed before.
  await expect(row).toContainText('Ready')

  await clickRowAction(page, row, 'Delete certificate')
  await expect(row).toHaveCount(0)
  await page.getByTestId('undo-delete-toast').getByRole('button', { name: 'Undo' }).click()
  await expect(rows(page).filter({ hasText: 'E2E payments host' })).toBeVisible()

  await clickRowAction(page, rows(page).filter({ hasText: 'E2E payments host' }), 'Delete certificate')
  await expect(rows(page).filter({ hasText: 'E2E payments host' })).toHaveCount(0)
  await deleteSecret(page, certRef)
  await deleteSecret(page, keyRef)
  await deleteSecret(page, tokenRef)
})

test('a host with no certificate says so, and Add one starts a certificate for that host', async ({ page }) => {
  await gotoAppReady(page)
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('URL', { exact: true }).fill('https://nothing.e2e.test/v1')
  await expect(page.getByTestId('clientcert-match-none')).toBeVisible()

  await page.getByTestId('clientcert-add-one').click()
  const root = page.getByTestId('configure-clientcerts')
  await expect(root).toBeVisible()
  await expect(root.getByTestId('clientcert-host')).toHaveValue('nothing.e2e.test')
})

test('a request whose host is covered names the certificate it will present', async ({ page }) => {
  const root = await openCertificates(page)
  await root.getByTestId('new-clientcert').click()
  await root.getByTestId('clientcert-label').fill('E2E covered estate')
  await root.getByTestId('clientcert-host').fill('*.covered.e2e.test')
  await root.getByTestId('save-clientcert').click()
  await expect(rows(page).filter({ hasText: 'E2E covered estate' })).toBeVisible()

  await openConfigureKind(page, 'Integrations')
  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('URL', { exact: true }).fill('https://api.covered.e2e.test/v1')
  await expect(page.getByTestId('clientcert-match')).toContainText('E2E covered estate')

  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Certificates')
  await clickRowAction(page, rows(page).filter({ hasText: 'E2E covered estate' }), 'Delete certificate')
  await expect(rows(page).filter({ hasText: 'E2E covered estate' })).toHaveCount(0)
})
