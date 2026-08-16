import { test, expect } from './fixtures/server'
import { groupCard, noteCard } from './fixtures/atlasCards'
import { clickRowAction } from './inventoryRow'
import { workflowRow, activePanel } from './fixtures/canvas'

// The right-click context menu (goal 0075): one shared Primer-native
// menu, surfaces own their items. Proof surfaces per the goal's
// acceptance: an Atlas card and a composition canvas step, extended
// here to the remaining surfaces -- inventory rows, work tabs, panes,
// and edges (goal 0075's completion).

function contextMenu(page: import('@playwright/test').Page) {
  return page.getByTestId('context-menu')
}

// Right-clicks a point inside `locator`'s own bounding box that's
// empty background -- every board/canvas this spec right-clicks for a
// pane menu lays its cards/nodes out in a single row near vertical
// center after fitView's padding, so the bottom-left corner is always
// clear of any node.
async function rightClickEmptyArea(locator: import('@playwright/test').Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('empty-area target has no bounding box')
  await locator.click({ button: 'right', position: { x: 12, y: box.height - 12 } })
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

test('right-click on an inventory row mirrors its kebab menu; Delete opens the same confirm dialog', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  const row = workflowRow(page, 'Example: Parent → child call')

  await row.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await expect(menu.getByText('Edit', { exact: true })).toBeVisible()
  await expect(menu.getByText('Export', { exact: true })).toBeVisible()
  await expect(menu.getByText('Delete', { exact: true })).toBeVisible()

  await menu.getByText('Delete', { exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(row).toBeVisible()
})

test('right-click on a work tab offers Close tab/others/all; a dirty tab still guards its close', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  await page.getByTestId('new-workflow').click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  const tab = page.getByRole('tab').last()
  await tab.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await expect(menu.getByText('Close tab', { exact: true })).toBeVisible()
  await expect(menu.getByText('Close other tabs', { exact: true })).toBeVisible()
  await expect(menu.getByText('Close all tabs', { exact: true })).toBeVisible()

  await menu.getByText('Close tab', { exact: true }).click()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)

  // A dirty tab's right-click Close tab still goes through the guard.
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByLabel('Label').fill('E2E context-menu dirty')
  await expect(page.getByTestId('dirty-indicator')).toBeVisible()
  await page.getByRole('tab').last().click({ button: 'right' })
  await expect(menu).toBeVisible()
  await menu.getByText('Close tab', { exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: "Don't save" }).click()
  await expect(page.getByRole('tab')).toHaveCount(1)
})

test('right-click on the Atlas board pane offers Add card…, opening the same child-create dialog', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const pane = page.locator('.react-flow__pane').first()
  await rightClickEmptyArea(pane)
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Add card…', { exact: true }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Add inside this card')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).not.toBeVisible()
})

test('right-click on the canvas pane: no menu in view mode; Add step… opens the palette in edit mode', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await workflowRow(page, 'Example: Parent → child call').click()

  const panel = activePanel(page)
  await expect(panel.getByTestId('edit-workflow')).toBeVisible()
  const pane = panel.locator('.react-flow__pane')
  await rightClickEmptyArea(pane)
  const menu = contextMenu(page)
  await expect(menu).not.toBeVisible()

  await panel.getByTestId('edit-workflow').click()
  await expect(panel.getByTestId('save-workflow')).toBeVisible()
  await rightClickEmptyArea(pane)
  await expect(menu).toBeVisible()
  await expect(menu.getByText('Add step…', { exact: true })).toBeVisible()
  await menu.getByText('Add step…', { exact: true }).click()
  await expect(panel.getByTestId('palette-panel')).toBeVisible()

  // Opening the palette touches no canvas content -- the tab is still
  // clean, so closing it needs no unsaved-close guard dialog.
  await page.getByRole('button', { name: 'Close tab' }).last().click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
})

test('right-click on a seeded Atlas artery offers Open for each connected card', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await page.locator('.react-flow__edge').first().click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await expect(menu.getByText('Open Getting started', { exact: true })).toBeVisible()
  await expect(menu.getByText('Open Example area', { exact: true })).toBeVisible()

  await menu.getByText('Open Getting started', { exact: true }).click()
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveText('Getting started')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()
})

test('right-click on a canvas edge: Select connection surfaces the edge inspector; Delete connection removes it', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await clickRowAction(page, workflowRow(page, 'Example: Parent → child call'), 'Edit')

  const panel = activePanel(page)
  await expect(panel.getByTestId('save-workflow')).toBeVisible()
  const inspector = panel.getByTestId('composition-inspector')
  await expect(inspector).toContainText('Select a step to configure it.')

  // This seeded workflow's two steps auto-position directly above/
  // below each other, so the edge draws as a perfectly vertical line
  // -- an SVG path with zero geometric width, which Playwright's own
  // actionability check reads as a zero-area (not-visible) box. force
  // skips that check and clicks the path's real on-screen center.
  const edge = panel.locator('.react-flow__edge').first()
  await edge.click({ button: 'right', force: true })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await expect(menu.getByText('Select connection', { exact: true })).toBeVisible()
  await expect(menu.getByText('Delete connection', { exact: true })).toBeVisible()
  await menu.getByText('Select connection', { exact: true }).click()
  await expect(inspector).toContainText('Only a Decision step’s outgoing edges are configurable.')

  await edge.click({ button: 'right', force: true })
  await expect(menu).toBeVisible()
  await menu.getByText('Delete connection', { exact: true }).click()
  await expect(panel.locator('.react-flow__edge')).toHaveCount(0)

  // Discard the edit so nothing leaks into later tests.
  await page.getByRole('button', { name: 'Close tab' }).last().click()
  await page.getByRole('button', { name: "Don't save" }).click()
})
