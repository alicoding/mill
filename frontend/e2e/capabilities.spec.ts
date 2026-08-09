import { test, expect } from '@playwright/test'

// Real Go bindings over HTTP (Wails3 server mode), not mocks -- same
// setup as runbook.spec.ts. Exercises the capability index built in
// docs/SPEC.md §2.2: CapabilitiesService.List() -> real React rows ->
// click-through to either a real page or PlaceholderView.
//
// Scoped to [data-testid="capability-index"]/[data-testid="capability-row"]
// rather than plain text, since capability labels ("Capability
// composition", "Configure") also appear inside SPEC.md's own rendered
// prose right below the index -- a bare getByText() match is ambiguous
// between the two.

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
  await expect(capabilityRow(page, 'Capability composition')).toBeVisible()
  await expect(capabilityRow(page, 'Configure')).toBeVisible()
})

test('Clicking a built capability navigates to its real page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Spec' }).click()

  await capabilityRow(page, 'Capability composition').getByRole('button', { name: 'Go to page' }).click()

  await expect(page.getByRole('heading', { name: 'Capability composition', exact: true })).toBeVisible()
})

test('Clicking the Configure capability navigates to its real page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Spec' }).click()

  await capabilityRow(page, 'Configure').getByRole('button', { name: 'Go to page' }).click()

  await expect(page.getByRole('tab', { name: 'Integration' })).toBeVisible()
})

test('Clicking a not-built capability shows a placeholder with status and a way back', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Spec' }).click()

  await capabilityRow(page, 'Guardrails / policy').getByRole('button', { name: 'View status' }).click()

  // Scoped to the main content region, not the whole page: the Spec
  // tab's own capability-map rows (below) also render 'OPEN' text, so a
  // page-wide getByText('OPEN') would be ambiguous. The sidebar's own
  // per-row status is a colored dot (aria-label/title only, no visible
  // text) since the App.tsx sidebar redesign, so it no longer competes
  // with this query either way.
  const content = page.getByRole('main')
  await expect(content.getByRole('heading', { name: 'Guardrails / policy', exact: true })).toBeVisible()
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
  await expect(triggerRow.getByText(/KindTrigger \+ five NodeTypes/i)).not.toBeVisible()
  await triggerRow.click()
  await expect(triggerRow.getByText(/KindTrigger \+ five NodeTypes/i)).toBeVisible()
})

test('Spec tab renders the architecture diagrams as real SVG, not raw code fences', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Spec' }).click()

  await expect(page.getByRole('heading', { name: 'Architecture at a glance' })).toBeVisible()
  // mermaid.run() replaces each `pre.mermaid` block's text content with an
  // <svg> in place -- if this is still raw ```mermaid text, the renderer
  // override or mermaid.run() wiring (SpecView.tsx) has regressed.
  const diagrams = page.locator('pre.mermaid svg')
  await expect(diagrams).toHaveCount(2)
})
