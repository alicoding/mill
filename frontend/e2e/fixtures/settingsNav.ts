import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

// Settings navigation (goal 0321): the page renders ONE group pane at
// a time, so reaching a control means naming its group -- the sidebar
// link alone lands on whichever pane this device last read.
export type SettingsGroup =
  | 'general' | 'appearance' | 'security' | 'shortcuts'
  | 'connections' | 'notifications' | 'backups' | 'updates'

// Extensions left Settings in goal 0349: it is its own destination,
// with its own tabs. Everything below still addresses the SAME row and
// detail components -- only the way in changed.
export type ExtensionsTab = 'installed' | 'browse' | 'updates'

export async function openExtensions(page: Page, tab: ExtensionsTab = 'installed'): Promise<void> {
  await page.getByRole('link', { name: 'Extensions' }).click()
  await expect(page.getByTestId('extensions-view')).toBeVisible()
  await page.getByTestId(`extensions-tab-${tab}`).click()
}

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

// One tab of an installed extension's detail (goal 0349). A built-in
// noun's pane has no strip at all, so this is a plugin-only step.
export type ExtensionDetailTab = 'overview' | 'contributions' | 'changelog' | 'verification' | 'settings'

export async function openExtensionDetailTab(detail: Locator, tab: ExtensionDetailTab): Promise<void> {
  await detail.getByTestId(`extensions-detail-tab-${tab}`).click()
}

// Opens Extensions and lands on one plugin's detail pane. Contributions
// is the default tab here because it is what a manifest claim reads
// from -- the pane itself opens on Overview.
export async function openPluginDetail(page: Page, id: string, tab: ExtensionDetailTab = 'contributions'): Promise<Locator> {
  await openExtensions(page)
  const detail = await openExtensionDetail(page, pluginRow(page, id), id)
  await openExtensionDetailTab(detail, tab)
  return detail
}
