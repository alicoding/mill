import { test, expect } from './fixtures/server'
import { groupCard, noteCard } from './fixtures/atlasCards'

// The right-click context menu (goal 0075): one shared Primer-native
// menu, surfaces own their items. Proof surfaces per the goal's
// acceptance: an Atlas card and a composition canvas step.

function contextMenu(page: import('@playwright/test').Page) {
  return page.getByTestId('context-menu')
}

test('right-click on an Atlas card offers Open, the share trio, and a confirmed Delete; a frame leads with Zoom in', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await noteCard(page, 'Getting started').click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await expect(menu.getByText('Open', { exact: true })).toBeVisible()
  await expect(menu.getByText('Copy as context')).toBeVisible()
  await expect(menu.getByText('Delete')).toBeVisible()
  // A leaf is not a place: no Zoom in.
  await expect(menu.getByText('Zoom in')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(menu).not.toBeVisible()

  // A region frame is a place first: Zoom in leads.
  await groupCard(page, 'Example area').click({ button: 'right', position: { x: 6, y: 60 } })
  await expect(menu).toBeVisible()
  await expect(menu.getByText('Zoom in')).toBeVisible()
  await page.keyboard.press('Escape')

  // Open goes straight to the card's page.
  await noteCard(page, 'Getting started').click({ button: 'right' })
  await menu.getByText('Open', { exact: true }).click()
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveText('Getting started')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()
})

test('right-click on a canvas step offers Open details everywhere; Delete step is disabled in view mode, real in edit mode', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  // Row click opens VIEW mode (docs/goals/0022, InventoryList's onOpen).
  await page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText('Example: Parent → child call', { exact: true }) }).click()

  const panel = page.locator('[role="tabpanel"]:not([hidden])').last()
  await expect(panel.getByTestId('edit-workflow')).toBeVisible()
  const step = panel.locator('.react-flow__node').first()
  await step.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await expect(menu.getByText('Open details')).toBeVisible()
  // View mode: visible but honest -- disabled, same as the toolbar.
  await expect(menu.locator('[aria-disabled="true"]', { hasText: 'Delete step' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).not.toBeVisible()

  // Edit mode: Delete step is real -- the step count drops by one.
  await panel.getByTestId('edit-workflow').click()
  await expect(panel.getByTestId('save-workflow')).toBeVisible()
  const before = await panel.locator('.react-flow__node').count()
  await panel.locator('.react-flow__node').first().click({ button: 'right' })
  await expect(menu).toBeVisible()
  await menu.getByText('Delete step').click()
  await expect(panel.locator('.react-flow__node')).toHaveCount(before - 1)

  // Discard the edit so nothing leaks into later tests (the unsaved-
  // close guard's own "Don't save" path).
  await page.getByRole('button', { name: 'Close tab' }).last().click()
  await page.getByRole('button', { name: "Don't save" }).click()
})
