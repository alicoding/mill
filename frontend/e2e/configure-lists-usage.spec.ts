import { test, expect } from './fixtures/server'
import { createList, deleteTableViaMenu, openAtlas, placeSizedTable } from './fixtures/atlasTable'
import { pressUndo } from './fixtures/undoJournal'
import { clickRowAction } from './inventoryRow'
import { openConfigureKind } from './fixtures/configureNav'
import { clickSelectionBarAction } from './fixtures/selectionBar'

// The object<->entity lifecycle contract (docs/goals/0392 S1): a
// board table's delete-time toast states the List's own fate, and
// Configure's Lists page surfaces usage/orphans off the same reference
// index. Shared pool -- both tests create and delete everything they
// touch, never depending on another spec's or the seeded example's own
// state.

function listRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText(label, { exact: true }) })
}

// Real Tab presses only (testing.md: focus via clicking/tabbing, never
// a programmatic .focus()) -- bounded since a row sits behind however
// many toolbar controls precede it, which this deliberately doesn't
// hard-code.
async function tabUntilFocused(page: import('@playwright/test').Page, locator: import('@playwright/test').Locator, maxPresses = 40) {
  for (let i = 0; i < maxPresses; i++) {
    if (await locator.evaluate((el) => el === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('tabUntilFocused: never reached the target row')
}

test('deleting a freshly placed table: the toast names the list as unused, and undo restores both the table and its usage', async ({ page }) => {
  await openAtlas(page)
  const object = await placeSizedTable(page, '2x2')
  const title = await object.getByTestId('atlas-table-title').textContent()
  if (!title) throw new Error('table has no title')

  await deleteTableViaMenu(object)
  await expect(page.getByTestId('atlas-undo-toast')).toContainText('Table removed from the board. The list is now unused in Configure.')

  await pressUndo(page)
  const restored = page.locator('[data-testid="atlas-board-object"][data-object-kind="table"]').filter({ hasText: title })
  await expect(restored).toHaveCount(1)

  // Undo re-adds the same live board reference the reference index
  // reads (no separate restore step) -- Configure's own usage line
  // reports the list as used again, off the identical index.
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Lists')
  const row = listRow(page, title)
  await expect(row).toContainText('Used on 1 board')

  // Clean up: delete the table again (this time for good) and the List
  // it minted, so nothing outlives this test on the shared server.
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  const stillThere = page.locator('[data-testid="atlas-board-object"][data-object-kind="table"]').filter({ hasText: title })
  await deleteTableViaMenu(stillThere)
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Lists')
  await clickRowAction(page, listRow(page, title), 'Delete')
  await expect(listRow(page, title)).toHaveCount(0)
})

// The shared selection model (goal 0404 S1), proved on Configure Lists'
// own Unused filter: a hover-revealed checkbox toggles, Shift-click
// ranges, ⌘A selects everything the filter currently shows, and
// Delete runs the SAME bulk-delete door every other InventoryList
// consumer uses -- one undo mark restores the whole selection with a
// single ⌘Z.
test('Configure Lists: hover checkbox, click, Shift-click range, ⌘A, and bulk delete with undo', async ({ page }) => {
  const stamp = Date.now()
  const labelA = `E2E sel A ${stamp}`
  const labelB = `E2E sel B ${stamp}`
  const labelC = `E2E sel C ${stamp}`
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Lists')

  for (const label of [labelA, labelB, labelC]) await createList(page, label)

  await page.getByTestId('list-usage-filter').selectOption('unused')
  const rowA = listRow(page, labelA)
  const rowB = listRow(page, labelB)
  const rowC = listRow(page, labelC)
  await expect(rowA).toBeVisible()
  await expect(rowB).toBeVisible()
  await expect(rowC).toBeVisible()

  // Hover reveals the checkbox (opacity-0 until :hover/:focus-within,
  // InventoryList.module.css); a plain click on it toggles without
  // opening the row.
  await rowA.hover()
  await rowA.getByTestId('inventory-row-select').click()
  await expect(page.getByTestId('selection-bar')).toBeVisible()
  await expect(page.getByTestId('selection-bar-count')).toHaveText('1 selected')
  // The bar's Delete action must render on the FIRST selection, not
  // wait for some later, unrelated re-render (goal 0404 S1: SelectionBar
  // subscribes to the focus store instead of reading a snapshot).
  await expect(page.getByTestId('selection-bar-action-list.deleteSelection')).toBeVisible()

  // Shift-click a range: the label text (never the checkbox) with
  // Shift held extends from the anchor through the clicked row.
  await rowC.getByText(labelC, { exact: true }).click({ modifiers: ['Shift'] })
  // count: fixture-owned -- A, B and C are the only lists this test created.
  await expect(page.getByTestId('selection-bar-count')).toHaveText('3 selected')

  // Esc clears.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('selection-bar')).toHaveCount(0)

  // ⌘A selects every row the Unused filter currently shows -- narrowed
  // to this test's own three rows via the shared `stamp` search term
  // first, so a concurrent spec's own unused list on the shared server
  // is never touched by it.
  // Scoped to this pane -- Configure's other kind panes stay mounted
  // (hidden) once visited, and getByTestId doesn't filter by visibility.
  await page.getByTestId('configure-lists').getByTestId('inventory-search').fill(String(stamp))
  await expect(page.locator('[data-testid="inventory-row"][data-entity="list"]')).toHaveCount(3) // count: fixture-owned -- the search term is this test's own timestamp, matching only A/B/C
  await rowA.hover()
  await rowA.getByTestId('inventory-row-select').click()
  await expect(page.getByTestId('selection-bar-count')).toHaveText('1 selected')
  await page.keyboard.press('Meta+a')
  // count: fixture-owned -- A, B and C are the only lists this test created.
  await expect(page.getByTestId('selection-bar-count')).toHaveText('3 selected')

  await clickSelectionBarAction(page, 'selection-bar-action-list.deleteSelection', 'Delete')
  await expect(page.getByTestId('undo-delete-toast')).toBeVisible()
  await expect(rowA).toHaveCount(0)
  await expect(rowB).toHaveCount(0)
  await expect(rowC).toHaveCount(0)

  // One ⌘Z restores the whole mark -- every deleted list comes back.
  await pressUndo(page)
  await expect(rowA).toBeVisible()
  await expect(rowB).toBeVisible()
  await expect(rowC).toBeVisible()

  // Cleanup: delete them for good (shared server, testing.md).
  await rowA.hover()
  await rowA.getByTestId('inventory-row-select').click()
  await rowB.hover()
  await rowB.getByTestId('inventory-row-select').click()
  await rowC.hover()
  await rowC.getByTestId('inventory-row-select').click()
  await clickSelectionBarAction(page, 'selection-bar-action-list.deleteSelection', 'Delete')
  await expect(rowA).toHaveCount(0)
  await expect(rowB).toHaveCount(0)
  await expect(rowC).toHaveCount(0)
})

// goal 0404 S1: the checkbox's own click degrading Shift/⌘ into a
// bare toggle (the row body's own Shift/⌘-click already worked; the
// checkbox path did not carry its modifiers into the same activation
// logic). Six rows so a
// checkbox Shift-click genuinely proves a multi-row range, not just
// two adjacent ones.
test('Configure Lists: Shift-click and ⌘-click on the CHECKBOX itself behave like the row body', async ({ page }) => {
  const stamp = Date.now()
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'].map((letter) => `E2E chk ${letter} ${stamp}`)
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Lists')

  for (const label of labels) await createList(page, label)

  await page.getByTestId('list-usage-filter').selectOption('unused')
  await page.getByTestId('configure-lists').getByTestId('inventory-search').fill(String(stamp))
  const rows = labels.map((label) => listRow(page, label))
  await expect(page.locator('[data-testid="inventory-row"][data-entity="list"]')).toHaveCount(6) // count: fixture-owned -- the search term is this test's own timestamp, matching only these 6
  const [rowA, rowB, , , , rowF] = rows

  // Click A's checkbox (a plain click still toggles), then Shift-click
  // F's checkbox: the full A..F range, not a second bare toggle. Each
  // clicked checkbox's own native `checked` must reflect the click,
  // not just the model/aria-checked (goal 0404 S1 amendment 3 --
  // preventDefault on a controlled checkbox desyncs the two).
  await rowA.hover()
  await rowA.getByTestId('inventory-row-select').click()
  await expect(page.getByTestId('selection-bar-count')).toHaveText('1 selected')
  await expect(rowA.getByTestId('inventory-row-select')).toBeChecked()
  await rowF.hover()
  await rowF.getByTestId('inventory-row-select').click({ modifiers: ['Shift'] })
  await expect(page.getByTestId('selection-bar-count')).toHaveText('6 selected')
  await expect(rowF.getByTestId('inventory-row-select')).toBeChecked()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('selection-bar')).toHaveCount(0)

  // ⌘-click on B's checkbox toggles without opening -- B's own editor
  // (the row's onOpen) never appears.
  await rowB.hover()
  await rowB.getByTestId('inventory-row-select').click({ modifiers: ['Meta'] })
  await expect(page.getByTestId('selection-bar-count')).toHaveText('1 selected')
  await expect(rowB.getByTestId('inventory-row-select')).toBeChecked()
  await expect(page.getByTestId('list-rows-editor')).toHaveCount(0)

  // Cleanup: select the whole range again and delete for good.
  await rowA.hover()
  await rowA.getByTestId('inventory-row-select').click()
  await rowF.hover()
  await rowF.getByTestId('inventory-row-select').click({ modifiers: ['Shift'] })
  await clickSelectionBarAction(page, 'selection-bar-action-list.deleteSelection', 'Delete')
  for (const row of rows) await expect(row).toHaveCount(0)
})

// goal 0404 S1: Tab lands on the row (the checkbox itself is out of
// the tab order); Space toggles, Shift+Space extends the range from
// the anchor, Enter still opens.
test('Configure Lists: keyboard selection on the focused row -- Tab, Space, Shift+Space, Enter', async ({ page }) => {
  const stamp = Date.now()
  const labelA = `E2E kbd A ${stamp}`
  const labelB = `E2E kbd B ${stamp}`
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Lists')

  await createList(page, labelA)
  await createList(page, labelB)

  await page.getByTestId('list-usage-filter').selectOption('unused')
  const search = page.getByTestId('configure-lists').getByTestId('inventory-search')
  await search.fill(String(stamp))
  const rowA = listRow(page, labelA)
  const rowB = listRow(page, labelB)
  await expect(page.locator('[data-testid="inventory-row"][data-entity="list"]')).toHaveCount(2) // count: fixture-owned -- the search term is this test's own timestamp, matching only A/B

  await search.click()
  await tabUntilFocused(page, rowA)
  await expect(rowA).toBeFocused()

  // Space toggles the FOCUSED row's own selection.
  await page.keyboard.press('Space')
  await expect(page.getByTestId('selection-bar-count')).toHaveText('1 selected')

  await tabUntilFocused(page, rowB)
  await expect(rowB).toBeFocused()
  await page.keyboard.press('Shift+Space')
  await expect(page.getByTestId('selection-bar-count')).toHaveText('2 selected')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('selection-bar')).toHaveCount(0)

  // Enter still opens the focused row -- Primer's own ActionList.Item
  // keyboard handling, untouched by the Space/x interception.
  await tabUntilFocused(page, rowA)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('list-rows-editor')).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()

  // Cleanup.
  await rowA.hover()
  await rowA.getByTestId('inventory-row-select').click()
  await rowB.hover()
  await rowB.getByTestId('inventory-row-select').click()
  await clickSelectionBarAction(page, 'selection-bar-action-list.deleteSelection', 'Delete')
  await expect(rowA).toHaveCount(0)
  await expect(rowB).toHaveCount(0)
})
