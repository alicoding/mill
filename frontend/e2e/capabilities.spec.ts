import { test, expect } from '@playwright/test'

// Real Go bindings over HTTP (Wails3 server mode), not mocks -- same
// setup as runbook.spec.ts. Exercises the capability index built in
// docs/SPEC.md §2.2: CapabilitiesService.List() -> real React rows ->
// click-through to either a real page or PlaceholderView.
//
// Scoped to [data-testid="capability-index"]/[data-testid="capability-row"]
// rather than plain text, since capability labels ("Runbook page",
// "Connectors") also appear inside SPEC.md's own rendered prose right
// below the index -- a bare getByText() match is ambiguous between the
// two.

function capabilityIndex(page: import('@playwright/test').Page) {
  return page.getByTestId('capability-index')
}

function capabilityRow(page: import('@playwright/test').Page, label: string) {
  return page.getByTestId('capability-row').filter({ hasText: label })
}

test('Spec tab lists capabilities with status badges', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Spec' }).click()
  await expect(capabilityIndex(page).getByRole('heading', { name: 'Capabilities' })).toBeVisible()
  await expect(capabilityRow(page, 'Runbook page')).toBeVisible()
  await expect(capabilityRow(page, 'Connectors')).toBeVisible()
})

test('Clicking a built capability navigates to its real page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Spec' }).click()

  await capabilityRow(page, 'Runbook page').getByRole('button', { name: 'Go to page' }).click()

  await expect(page.getByRole('heading', { name: 'Runbook', exact: true })).toBeVisible()
})

test('Clicking a not-built capability shows a placeholder with status and a way back', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Spec' }).click()

  await capabilityRow(page, 'Connectors').getByRole('button', { name: 'View status' }).click()

  await expect(page.getByRole('heading', { name: 'Connectors', exact: true })).toBeVisible()
  await expect(page.getByText("hasn't been built yet")).toBeVisible()
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Back to Spec' }).click()
  await expect(capabilityIndex(page).getByRole('heading', { name: 'Capabilities' })).toBeVisible()
})
