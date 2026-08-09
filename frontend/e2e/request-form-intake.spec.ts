import { test, expect } from '@playwright/test'

// Exercises ADR-0016 Phase B's entity half + the unified schema intake
// (docs/SPEC.md §4's Update): Method is a first-class request field
// beside Base URL (not buried in schema authoring), and one intake
// block accepts a JSON sample or CSV and lands the result in the
// always-visible manual editor -- over real Go bindings (Wails3 server
// mode), not mocks.

function requestRow(page: import('@playwright/test').Page, label: string) {
  return page.getByTestId('request-row').filter({ has: page.getByText(label, { exact: true }) })
}

async function deleteRequest(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('link', { name: 'Configure' }).click()
  await requestRow(page, label).getByRole('button', { name: `Delete ${label}` }).click()
  await expect(requestRow(page, label)).toHaveCount(0)
}

test('Method is set beside Base URL and round-trips through save/edit', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('Method Row Request')
  await page.getByTestId('request-method').selectOption('POST')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')
  await page.getByRole('button', { name: 'Save request' }).click()

  const row = requestRow(page, 'Method Row Request')
  await expect(row).toBeVisible()

  // The read-only summary shows the method; Edit reloads it.
  await row.getByText('Method Row Request', { exact: true }).click()
  await expect(page.getByTestId('request-summary')).toBeVisible()
  await expect(page.getByTestId('request-summary').getByText('POST', { exact: true })).toBeVisible()
  await page.getByTestId('summary-edit').click()
  await expect(page.getByTestId('request-method')).toHaveValue('POST')
  await page.getByRole('button', { name: 'Cancel' }).click()

  await deleteRequest(page, 'Method Row Request')
})

test('Schema intake infers request-body fields from a pasted JSON sample', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('Sample Intake Request')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')

  await page.getByTestId('schema-intake-text').fill(JSON.stringify({ widget: 'w-1', count: 3 }))
  await page.getByTestId('schema-intake-load').click()
  await expect(page.getByTestId('schema-intake-notice')).toBeVisible()

  const operation = page.getByTestId('manual-operation')
  const rows = operation.getByTestId('manual-field-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0).getByLabel('Field name')).toHaveValue('widget')
  await expect(rows.nth(1).getByLabel('Field name')).toHaveValue('count')
  await expect(rows.nth(1).getByLabel('Field type')).toHaveValue('integer')

  await page.getByRole('button', { name: 'Save request' }).click()
  await expect(requestRow(page, 'Sample Intake Request')).toBeVisible()
  await deleteRequest(page, 'Sample Intake Request')
})

test('Schema intake loads CSV field rows into the editor', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('CSV Intake Request')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')

  const csv = [
    'path,method,direction,name,in,type,required,secret,alias,extractPath',
    '/widgets,GET,input,q,query,string,false,false,,',
    '/widgets,GET,output,name,body,string,false,false,,',
  ].join('\n')
  await page.getByTestId('schema-intake-text').fill(csv)
  await page.getByTestId('schema-intake-load').click()
  await expect(page.getByTestId('schema-intake-notice')).toBeVisible()

  const operation = page.getByTestId('manual-operation')
  // exact: true -- the output row's own "Extract path" input also
  // substring-matches a bare 'Path' label.
  await expect(operation.getByLabel('Path', { exact: true })).toHaveValue('/widgets')
  const rows = operation.getByTestId('manual-field-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0).getByLabel('Field name')).toHaveValue('q')

  await page.getByRole('button', { name: 'Save request' }).click()
  await expect(requestRow(page, 'CSV Intake Request')).toBeVisible()
  await deleteRequest(page, 'CSV Intake Request')
})
