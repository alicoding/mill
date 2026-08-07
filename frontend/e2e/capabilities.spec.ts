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

  // Scoped to the main content region, not the whole page: the sidebar
  // itself also shows an OPEN status Label per not-yet-built capability
  // (docs/SPEC.md §2.2's "every capability gets a nav entry" change), so
  // a page-wide getByText('OPEN') is ambiguous between the sidebar and
  // this placeholder's own status badge.
  const content = page.getByRole('main')
  await expect(content.getByRole('heading', { name: 'Connectors', exact: true })).toBeVisible()
  await expect(content.getByText("hasn't been built yet")).toBeVisible()
  await expect(content.getByText('OPEN', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Back to Spec' }).click()
  await expect(capabilityIndex(page).getByRole('heading', { name: 'Capabilities' })).toBeVisible()
})

test('Spec tab shows the composition capability map, real data not parsed markdown', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Spec' }).click()

  const map = page.getByTestId('composition-capability-map')
  await expect(map.getByRole('heading', { name: 'Composition capability map' })).toBeVisible()

  const rows = page.getByTestId('capability-map-row')
  await expect(rows).toHaveCount(12)

  const triggerRow = rows.filter({ hasText: 'Trigger' })
  await expect(triggerRow).toBeVisible()
  await expect(triggerRow.getByText('mixed')).toBeVisible()
  await expect(triggerRow.getByText('OPEN')).toBeVisible()

  // Collapsed by default -- detail text only appears after expanding.
  await expect(triggerRow.getByText(/hotkey mechanism exists/i)).not.toBeVisible()
  await triggerRow.click()
  await expect(triggerRow.getByText(/hotkey mechanism exists/i)).toBeVisible()
})
