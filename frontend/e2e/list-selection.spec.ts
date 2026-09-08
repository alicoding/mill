import { test, expect } from './fixtures/server'
import { workflowRow } from './fixtures/canvas'
import { pressUndo } from './fixtures/undoJournal'
import { createList, createTableFromList, deleteTableViaMenu, openAtlas } from './fixtures/atlasTable'
import { openConfigureKind } from './fixtures/configureNav'
import { clickSelectionBarAction } from './fixtures/selectionBar'

// The shared selection model + bulk delete door (goal 0404 S1) across
// the surfaces Configure Lists (configure-lists-usage.spec.ts) doesn't
// already cover: Workflows' own undo (the amendment that gave
// CompositionService.DeleteWorkflow a journal entry), a refused item
// kept and named, and the companion-width long-press entry. Shared
// pool -- every test creates and deletes everything it touches.

function listRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText(label, { exact: true }) })
}

test('Workflows: select two, Delete, one ⌘Z restores both', async ({ page }) => {
  const stamp = Date.now()
  const labelA = `E2E wf sel A ${stamp}`
  const labelB = `E2E wf sel B ${stamp}`
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  for (const label of [labelA, labelB]) {
    await page.getByTestId('new-workflow').click()
    const panel = page.locator('[role="tabpanel"]:not([hidden])').last()
    await panel.getByLabel('Label').fill(label)
    await panel.getByTestId('save-workflow').click()
  }

  const rowA = workflowRow(page, labelA)
  const rowB = workflowRow(page, labelB)
  await expect(rowA).toBeVisible()
  await expect(rowB).toBeVisible()

  await rowA.hover()
  await rowA.getByTestId('inventory-row-select').click()
  await rowB.hover()
  await rowB.getByTestId('inventory-row-select').click()
  await expect(page.getByTestId('selection-bar-count')).toHaveText('2 selected')

  await clickSelectionBarAction(page, 'selection-bar-action-list.deleteSelection', 'Delete')
  await expect(page.getByTestId('undo-delete-toast')).toBeVisible()
  await expect(rowA).toHaveCount(0)
  await expect(rowB).toHaveCount(0)

  // A bulk workflow delete now registers into the SAME journal a
  // Configure entity's does (the goal's amendment) -- one ⌘Z restores
  // both nodes/edges intact, not one row per press.
  await pressUndo(page)
  await expect(rowA).toBeVisible()
  await expect(rowB).toBeVisible()

  // Cleanup.
  await rowA.hover()
  await rowA.getByTestId('inventory-row-select').click()
  await rowB.hover()
  await rowB.getByTestId('inventory-row-select').click()
  await clickSelectionBarAction(page, 'selection-bar-action-list.deleteSelection', 'Delete')
  await expect(rowA).toHaveCount(0)
  await expect(rowB).toHaveCount(0)
})

test('Configure Lists: a referenced list is kept and named, an unused one is deleted, in the same bulk action', async ({ page }) => {
  const stamp = Date.now()
  const usedLabel = `E2E sel used ${stamp}`
  const unusedLabel = `E2E sel unused ${stamp}`

  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Lists')
  await createList(page, usedLabel)
  await createList(page, unusedLabel)

  // Place a table from the first list -- referenced, so DeleteList
  // refuses it (configurelist.go's own precheck).
  await openAtlas(page)
  const object = await createTableFromList(page, usedLabel, usedLabel)

  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Lists')
  const usedRow = listRow(page, usedLabel)
  const unusedRow = listRow(page, unusedLabel)
  await expect(usedRow).toContainText('Used on 1 board')

  await usedRow.hover()
  await usedRow.getByTestId('inventory-row-select').click()
  await unusedRow.hover()
  await unusedRow.getByTestId('inventory-row-select').click()
  await expect(page.getByTestId('selection-bar-count')).toHaveText('2 selected')

  await clickSelectionBarAction(page, 'selection-bar-action-list.deleteSelection', 'Delete')
  await expect(page.getByTestId('undo-delete-toast')).toContainText(`Deleted 1 list. 1 kept: still in use (${usedLabel}).`)
  await expect(unusedRow).toHaveCount(0)
  await expect(usedRow).toBeVisible()

  // Cleanup: drop the table, then the now-unused list it referenced.
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  await deleteTableViaMenu(object)
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Lists')
  await usedRow.hover()
  await usedRow.getByTestId('inventory-row-select').click()
  await clickSelectionBarAction(page, 'selection-bar-action-list.deleteSelection', 'Delete')
  await expect(usedRow).toHaveCount(0)
})

test('Configure Lists at companion width: a long-press on a row enters selection mode', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByTestId('mobile-nav-toggle').click()
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Lists')

  const label = `E2E sel longpress ${Date.now()}`
  await createList(page, label)
  const row = listRow(page, label)
  await expect(row).toBeVisible()

  // Playwright's touchscreen API offers only tap() -- no real
  // press-and-hold primitive exists to drive this gesture (testing.md's
  // own carve-out: a synthetic dispatchEvent is the last resort when no
  // real user primitive can reach it, same class as the native-drop
  // gesture). pointerType 'touch' is what useListSelection's own
  // long-press handler gates on.
  await row.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 20, clientY: 20 })
  await page.waitForTimeout(600) // LONG_PRESS_MS is 500 -- held past the threshold before releasing
  await row.dispatchEvent('pointerup', { pointerType: 'touch' })

  await expect(page.getByTestId('selection-bar')).toBeVisible()
  await expect(page.getByTestId('selection-bar-count')).toHaveText('1 selected')

  // Cleanup.
  await clickSelectionBarAction(page, 'selection-bar-action-list.deleteSelection', 'Delete')
  await expect(row).toHaveCount(0)
})
