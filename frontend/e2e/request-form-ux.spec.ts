import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// Exercises goal 0370's request-builder-shaped fixes on RequestForm.tsx:
// the Method Select's clipped-text root cause (no width -- confirmed
// against Primer's own Select.js, which never forwards minWidth/width/
// maxWidth to its wrapper, only className), the Method+URL row's
// responsive stack, and the on-form Test action reusing the exact
// request-test door request-test-panel.spec.ts already covers for the
// saved record's own tab.

function requestRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="request"]').filter({ has: page.getByText(label, { exact: true }) })
}

async function deleteRequest(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('link', { name: 'Configure' }).click()
  await clickRowAction(page, requestRow(page, label), 'Delete')
  await expect(requestRow(page, label)).toHaveCount(0)
}

test('The Method select never clips its selected option, at 1024px or the companion breakpoint', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()

  const method = page.getByTestId('request-method')
  await method.selectOption('OPTIONS')

  for (const width of [1024, 720]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(method).toBeVisible()
    const overflow = await method.evaluate((el: HTMLSelectElement) => el.scrollWidth - el.clientWidth)
    expect(overflow, `Method select clips at ${width}px`).toBeLessThanOrEqual(0)
    const optionLabels = await method.evaluate((el: HTMLSelectElement) => Array.from(el.options).map((o) => o.textContent))
    expect(optionLabels).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY'])
  }

  // Nothing was saved -- the tab closes with the draft, no cleanup needed.
  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('Method and URL share one row at 1024px and stack below the companion breakpoint', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()

  const method = page.getByTestId('request-method')
  const url = page.getByLabel('URL', { exact: true })

  await page.setViewportSize({ width: 1024, height: 900 })
  const wideMethodBox = await method.boundingBox()
  const wideUrlBox = await url.boundingBox()
  expect(wideMethodBox).not.toBeNull()
  expect(wideUrlBox).not.toBeNull()
  // Same row: URL renders to the right of Method (align="end" on the
  // row means their two FormControls' bottoms line up, not necessarily
  // the inner controls' own vertical centers -- URL's own
  // FormControl.Caption makes its FormControl taller than Method's).
  expect(wideUrlBox!.x).toBeGreaterThanOrEqual(wideMethodBox!.x + wideMethodBox!.width)

  await page.setViewportSize({ width: 720, height: 900 })
  const narrowMethodBox = await method.boundingBox()
  const narrowUrlBox = await url.boundingBox()
  expect(narrowMethodBox).not.toBeNull()
  expect(narrowUrlBox).not.toBeNull()
  // Stacked: URL renders on a later row, well below Method's own row.
  expect(narrowUrlBox!.y).toBeGreaterThan(narrowMethodBox!.y + narrowMethodBox!.height)

  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('Test on a draft is disabled until the URL is filled, then returns a result pane', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('Form Test Draft Request')

  const testButton = page.getByTestId('request-test-draft')
  await expect(testButton).toBeDisabled()

  // Port 1 is reserved and essentially never bound -- a deterministic
  // connection-refused, not a real remote host (same fixture
  // request-test-panel.spec.ts's own equivalent test uses).
  await page.getByLabel('URL', { exact: true }).fill('http://127.0.0.1:1/widgets')
  await expect(testButton).toBeEnabled()

  const editor = page.getByTestId('manual-schema-editor')
  const operation = editor.getByTestId('manual-operation')
  await operation.getByRole('button', { name: 'Add parameter' }).click()
  await operation.getByTestId('manual-field-row').last().getByLabel('Field name').fill('q')

  await testButton.click()
  const testPanel = page.getByTestId('request-test-panel')
  await expect(testPanel).toBeVisible()
  const logEntry = testPanel.getByTestId('request-test-log-entry').first()
  await expect(logEntry).toBeVisible({ timeout: 30_000 })
  await expect(logEntry.getByText('error', { exact: true })).toBeVisible()
  await expect(testButton).toHaveText('Test')

  // Save proves the draft's own Test action didn't disturb Save's own
  // path -- same field values a save would persist.
  await page.getByRole('button', { name: 'Save integration' }).click()
  await expect(requestRow(page, 'Form Test Draft Request')).toBeVisible()
  await deleteRequest(page, 'Form Test Draft Request')
})

test('Test with only a method and URL shows the result pane', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('No Schema Draft Request')
  // Port 1 is reserved and essentially never bound -- a deterministic
  // connection-refused, not a real remote host (same fixture
  // request-test-panel.spec.ts's own equivalent test uses).
  await page.getByLabel('URL', { exact: true }).fill('http://127.0.0.1:1/widgets')

  // No schema authored -- the Schema tab's editor is left at its
  // default blank operation, never given a path or a field.
  const testButton = page.getByTestId('request-test-draft')
  await expect(testButton).toBeEnabled()
  await testButton.click()

  const testPanel = page.getByTestId('request-test-panel')
  await expect(testPanel).toBeVisible()
  const logEntry = testPanel.getByTestId('request-test-log-entry').first()
  await expect(logEntry).toBeVisible({ timeout: 30_000 })
  await expect(logEntry.getByText('error', { exact: true })).toBeVisible()
  await expect(testButton).toHaveText('Test')
  // The Declare-a-Schema sentence is a hint under the result, never a
  // gate that replaced the panel.
  await expect(testPanel.getByTestId('declare-schema-hint')).toBeVisible()

  await page.getByRole('button', { name: 'Save integration' }).click()
  await expect(requestRow(page, 'No Schema Draft Request')).toBeVisible()
  await deleteRequest(page, 'No Schema Draft Request')
})
