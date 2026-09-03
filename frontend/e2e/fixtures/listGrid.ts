import { expect, type Page } from '@playwright/test'

// Grid-based column authoring (goal 0136): the append ⊕ drops a
// placeholder straight into rename; naming it re-keys it from the
// label (empty columns only), so "SKU" becomes key sku.
export async function addGridColumn(page: Page, label: string) {
  await page.getByTestId('atlas-projection-add-column').click()
  const input = page.getByTestId('atlas-projection-rename-input')
  await expect(input).toBeVisible()
  await input.fill(label)
  await input.press('Enter')
  await expect(page.getByTestId('atlas-projection-glide').locator('[role="columnheader"]').filter({ hasText: label })).toBeAttached()
}
