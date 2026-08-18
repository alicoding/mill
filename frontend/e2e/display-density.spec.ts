import { test, expect } from './fixtures/server'

// docs/goals/0096-display-density.md: Comfortable/Compact, a
// Settings-driven app root attribute (data-density) that tightens
// row-based surfaces' vertical padding. Measures a real workflow row's
// rendered height rather than any internal Primer class/DOM shape --
// robust to how ActionList happens to structure its own markup, and a
// direct proxy for the CSS custom property chain this goal wires
// (index.css's --mill-density-row-pad-y -> InventoryList.module.css's
// --control-medium-paddingBlock override).

async function firstWorkflowRow(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: 'Workflows' }).click()
  const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').first()
  await expect(row).toBeVisible()
  return row
}

async function setDensity(page: import('@playwright/test').Page, label: 'Comfortable' | 'Compact') {
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByTestId('settings-view')).toBeVisible()
  await page.getByTestId('density-control').getByRole('button', { name: label }).click()
}

test('Compact visibly tightens a workflow row, persists across reload, and Comfortable restores the original height', async ({ page }) => {
  await page.goto('/')

  const comfortableRow = await firstWorkflowRow(page)
  const comfortableBox = await comfortableRow.boundingBox()
  const comfortableHeight = comfortableBox?.height ?? 0
  expect(comfortableHeight).toBeGreaterThan(0)

  await setDensity(page, 'Compact')
  const compactRow = await firstWorkflowRow(page)
  // Perceptibility floor: a density mode the eye can't catch fails its
  // one job -- compact must reclaim at least 6px per row, not merely
  // measure smaller.
  await expect.poll(async () => (await compactRow.boundingBox())?.height ?? 0).toBeLessThanOrEqual(comfortableHeight - 6)

  await page.reload()
  const afterReloadRow = await firstWorkflowRow(page)
  await expect.poll(async () => (await afterReloadRow.boundingBox())?.height ?? 0).toBeLessThan(comfortableHeight)

  // Leaves the shared e2e settings file back at the default, matching
  // this repo's other settings specs' own cleanup discipline.
  await setDensity(page, 'Comfortable')
  const restoredRow = await firstWorkflowRow(page)
  await expect.poll(async () => (await restoredRow.boundingBox())?.height ?? 0).toBe(comfortableHeight)
})

test('Density select reflects the persisted preference on a fresh Settings visit', async ({ page }) => {
  await page.goto('/')
  await setDensity(page, 'Compact')

  await page.reload()
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByTestId('density-control').getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true')

  // Cleanup, same reasoning as the test above.
  await setDensity(page, 'Comfortable')
})

test.describe('mobile viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('Compact keeps a 44px workflow row touch target at the companion breakpoint', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('mobile-nav-toggle').click()
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByTestId('settings-view')).toBeVisible()
    await page.getByTestId('density-control').getByRole('button', { name: 'Compact' }).click()

    await page.getByTestId('mobile-nav-toggle').click()
    const row = await firstWorkflowRow(page)
    const box = await row.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)

    // Cleanup, same reasoning as the tests above.
    await page.getByTestId('mobile-nav-toggle').click()
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByTestId('density-control').getByRole('button', { name: 'Comfortable' }).click()
  })
})
