// Client certificates (goal 0306 S1): the Configure entity naming which
// certificate Mill presents to which host. Shared worker pool: every
// assertion reads only the seeded example and what this file creates
// and deletes itself.
import { test, expect } from './fixtures/server'
import { gotoAppReady } from './fixtures/appReady'
import { createSecret, deleteSecret } from './fixtures/secretStore'
import { clickRowAction } from './inventoryRow'

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
  await page.getByRole('tab', { name: 'Certificates' }).click()
  const root = page.getByTestId('configure-clientcerts')
  await expect(root).toBeVisible()
  return root
}

// A self-signed client pair with a century of validity, so the status
// this spec asserts is "Ready" for as long as the spec exists. Real
// material, because the status comes from a real decode.
const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDLDCCAhSgAwIBAgIUUen7JigTFOjs1nmK9/644PBOBqUwDQYJKoZIhvcNAQEL
BQAwGjEYMBYGA1UEAwwPbWlsbC1lMmUtY2xpZW50MCAXDTI2MDkwNTA0NDUxNFoY
DzIxMjYwODEyMDQ0NTE0WjAaMRgwFgYDVQQDDA9taWxsLWUyZS1jbGllbnQwggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC+0qAgy0Kj1leAZCaksIcqTJAl
/FYj0AGQYT+v/+f5LP2Jucow/D0SelfY6fQd6vShSvH0RHCy0QiHZdFf1cV/ctqE
EAzLuzlLpWtXmBJHn+6vPFFPm0kTbO64luMe4/7PK4Tar5GjdrvYFzda1AZQLDTH
6mRWhq2O6lGsCJau63KBzP1rUNETX/8QFJSmZA/Yhu+zE/yRal/IHIMh2frrwN74
t9btb6HHOtFEgHPpkNZBdrwcNwlj/Hjv0W6epq4dHgPwHT5eOSQJnYN9LmMFPyMQ
yLCX0DzydSCqxVKWpH8m1auhVVQuGi8Ajf7sKEGakcWRfPCjagTlHixrmgkjAgMB
AAGjaDBmMB0GA1UdDgQWBBTeMuggsE2vnZnWCLKJ0IQGdDhKAjAfBgNVHSMEGDAW
gBTeMuggsE2vnZnWCLKJ0IQGdDhKAjAPBgNVHRMBAf8EBTADAQH/MBMGA1UdJQQM
MAoGCCsGAQUFBwMCMA0GCSqGSIb3DQEBCwUAA4IBAQCK13UsyaX4GXMohqpbXBqW
il8ng0aBuNYV93xctjh4nj3PghskJoNoItzT3ScizvwbnzsdixDkE0ff+xpp7DUS
mmccd5Z+0Zt5p59XvKG6OFPeEJqd/Ahho3IZfe4ADj22Krb66INtxrcHuLnpaEAN
9+RfYFoEPqhZddtV1Ppv4p3z7hsNFJvfyg74RPi/VpC0ewiO9rlXf50P1C0bblFS
NzBAf3Yyf2lbwNUyuSYcF1Z8PJeoy0t6FyI/hdquT6B47cgKAr69iWSgrGeNm8qk
7QHo257uxI4etaMGq3SSARcmqfsXlOV3BU54cstxh3J6igRxRwKkthT2XnDtqo8t
-----END CERTIFICATE-----
`

const KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC+0qAgy0Kj1leA
ZCaksIcqTJAl/FYj0AGQYT+v/+f5LP2Jucow/D0SelfY6fQd6vShSvH0RHCy0QiH
ZdFf1cV/ctqEEAzLuzlLpWtXmBJHn+6vPFFPm0kTbO64luMe4/7PK4Tar5GjdrvY
Fzda1AZQLDTH6mRWhq2O6lGsCJau63KBzP1rUNETX/8QFJSmZA/Yhu+zE/yRal/I
HIMh2frrwN74t9btb6HHOtFEgHPpkNZBdrwcNwlj/Hjv0W6epq4dHgPwHT5eOSQJ
nYN9LmMFPyMQyLCX0DzydSCqxVKWpH8m1auhVVQuGi8Ajf7sKEGakcWRfPCjagTl
HixrmgkjAgMBAAECggEAN682HCvEaBQR170iC7gZ0W2jOPqAVpYKBsxiLeVjF7MZ
z3mAd7f7yGscPIfU/XAFcBXzMkFQk9XtA7niFfHHXtAw1Q3r9f3OE/WTM+4EE5On
rspOvgjGE92bchFR+L82qdT8wWYvfUCWQ1JPDHnH19h2lIohOqC1f/l/2NBuzF8W
VDS8E3aTVpe99Ap1Bf486q37yUKMMTJBE5ZxGm32VP8iAFS+BbyEOwXytJiPmw6B
Bv1juEixMQmDXRjbsiivrbyoy10KNpo6QCXHw/fAGFCzqiwf17yyqLAkwJG54Q26
jIpul2PEehZeou8e1VD48k08mMvIoQqHZZ7szWacLQKBgQDvakj9y+/e78FUfe/C
8nkOfiXJ0P7vxCujdorjh3LUvw109+f5XVVmMUQh4akk2OJdWwD8cNQ20r987gwk
eQLXvBTBUbmyq+i/lTP/Ra1NhrDGZzNEXnHUEVlF2xZ75tXIssh/vUtXR3bI0CQf
MR+7c4N0u7QTzykuQ+QdcB2kRQKBgQDMCp4M8GALgo8H5pjcfGH+kCwessPZ8fan
u63fOnb85/258B+Dk3SDzyxAsLJthESWjpNSfAcTTjZAqX5wwjXoRTqe3ilt8b6H
BpK7qH64cpXHLtgGQiEd4RdkLNztXZN1VWr8Ocjkyb1x/dFe5e5l1cz1yjvvpTuh
0D2extwyRwKBgQDuI+ZerI/4TLsc8/edDdpkFA46ZGxwycwuWCdmksAh5bfY9Q4E
+FWNxMtkeDXqtODUw0SD1ScBMTfPaGkjjkrJlAeBE22Gz4A/sIV8ES6EwsjrUJOq
GddXfboyxe3jaISVkV/lz8A1HJyGuqJzdEWACzJi1qIUYicwIc+xiGezkQKBgHHi
XzLzm3fxKCoNwDYYSo3OJIIB3ySvU69tJm/Y7v7b8ZctejlzPO4w3Q9CUGSmFa4+
5+V7CmvxFIDk2YjQLUx2D3EKqO8PpfsxZQbO1ePXONgSwkpD8L3/m5GzJKBrwVkV
EwCys/lWzKFqPMkN5xD500tA1FE+1VjMpQgREGgTAoGBAIACG/mMfcWM3AxSrxe4
WOK/LzwhrY3V2GUzybXqL9/F22AkMHln1Qm4TgtJpLSYIOMs984woBfwijXZAtBZ
7ZBaF2b1gIBZu//hUOFSdyPZduG5q2HkvWoqKstgjDhfO6h6A2NOGbM5m5mIwZ0c
YcVOVu6SwAoC2KE3KxrxQsjb
-----END PRIVATE KEY-----
`

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
  const certRef = await createSecret(page, 'e2e client certificate', CERT_PEM, 'certificate')
  const keyRef = await createSecret(page, 'e2e client key', KEY_PEM, 'key')
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

  await page.getByRole('tab', { name: 'Integration' }).click()
  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('URL', { exact: true }).fill('https://api.covered.e2e.test/v1')
  await expect(page.getByTestId('clientcert-match')).toContainText('E2E covered estate')

  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Certificates' }).click()
  await clickRowAction(page, rows(page).filter({ hasText: 'E2E covered estate' }), 'Delete certificate')
  await expect(rows(page).filter({ hasText: 'E2E covered estate' })).toHaveCount(0)
})
