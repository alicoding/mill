import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

// Settings navigation (goal 0321): the page renders ONE group pane at
// a time, so reaching a control means naming its group -- the sidebar
// link alone lands on whichever pane this device last read.
export type SettingsGroup =
  | 'general' | 'appearance' | 'shortcuts' | 'extensions'
  | 'connections' | 'notifications' | 'backups' | 'updates'

export async function openSettings(page: Page, group: SettingsGroup = 'general'): Promise<void> {
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByTestId('settings-view')).toBeVisible()
  await page.getByTestId(`settings-group-item-${group}`).click()
  await expect(page.getByTestId(`settings-pane-${group}`)).toBeVisible()
}

// A built-in noun's row in the Extensions list.
export function extensionRow(page: Page, id: string): Locator {
  return page.locator(`[data-testid="extensions-row"][data-extension-id="${id}"]`)
}

// Every COMPILED-IN row, and only those: built-ins and installed
// plugins share one row component (goal 0321), so a bare
// extensions-row locator matches both.
export function builtInRows(page: Page): Locator {
  return page.locator('[data-testid^="extensions-group-"] [data-testid="extensions-row"]')
}

// An installed plugin's row.
export function pluginRow(page: Page, id: string): Locator {
  return page.locator(`[data-testid="extensions-plugin-row"][data-plugin-id="${id}"]`)
}

// Opens one row's detail pane and returns it. A row states identity
// only; every other fact about an extension reads in the pane.
export async function openExtensionDetail(page: Page, row: Locator, id: string): Promise<Locator> {
  await row.scrollIntoViewIfNeeded()
  await row.getByTestId('extensions-row-open').click()
  const detail = page.locator(`[data-testid="extensions-detail"][data-extension-id="${id}"]`)
  await expect(detail).toBeVisible()
  return detail
}

// Opens Extensions and lands on one plugin's detail pane -- the two
// steps every runtime-plugin spec takes to read a manifest claim.
export async function openPluginDetail(page: Page, id: string): Promise<Locator> {
  await openSettings(page, 'extensions')
  return openExtensionDetail(page, pluginRow(page, id), id)
}
