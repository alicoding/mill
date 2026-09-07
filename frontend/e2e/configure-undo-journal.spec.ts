import { test, expect, type Page } from './fixtures/server'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { pressUndo } from './fixtures/undoJournal'
import { clickGlideCell, editGlideCell, glideCellText } from './fixtures/glideGrid'
import { openConfigureKind } from './fixtures/configureNav'
import { clickRowAction } from './inventoryRow'

// Goal 0352 part 2: a List's schema edits and a Configure entity's
// delete are steps on the ONE actor-scoped undo journal (ADR-0044's
// amendment), and the delete toast is an affordance over that journal
// -- its Undo button pops the same step ⌘Z would, and the toast hides
// once the journal's top step is no longer the delete it offers.
//
// Shared pool: every List here is created over the bound service and
// deleted at the end, so nothing depends on state another test left.

const CONFIGURE = 'github.com/alicoding/mill/internal/services/configuresvc.ConfigureService'

const COLUMNS = [
  { Key: 'name', Label: 'Name', Type: 'text' },
  { Key: 'qty', Label: 'Qty', Type: 'number' },
]

interface SeededList { ID: string }

async function seedList(page: Page, label: string, rows: Record<string, string>[]): Promise<string> {
  const list = await callBindingViaRPC<SeededList>(page, `${CONFIGURE}.CreateListWithRows`, [label, '', COLUMNS, rows])
  return list.ID
}

async function openListsInventory(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Configure' }).click()
  await openConfigureKind(page, 'Lists')
}

function listRow(page: Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="list"]').filter({ hasText: label })
}

async function openGrid(page: Page, label: string) {
  await listRow(page, label).click()
  const glide = page.getByTestId('atlas-projection-glide')
  await expect(glide.locator('[role="grid"]')).toBeAttached()
  return glide
}

async function cleanup(page: Page, id: string): Promise<void> {
  await callBindingViaRPC(page, `${CONFIGURE}.DeleteList`, [id]).catch(() => undefined)
}

const TWO_ROWS = [
  { name: 'Bolt', qty: '1' },
  { name: 'Anvil', qty: '3' },
]

// Removing a column hides it but keeps its values (the removal is a
// tombstone, not a deletion), so ⌘Z brings back the column AND what
// was in it.
test('⌘Z after removing a column brings back the column and its values', async ({ page }) => {
  await page.goto('/')
  const id = await seedList(page, 'E2E schema undo', TWO_ROWS)
  await openListsInventory(page)
  const glide = await openGrid(page, 'E2E schema undo')

  await clickGlideCell(page, glide, -1, 1)
  await expect(page.getByTestId('list-grid-delete-column')).toBeVisible()
  await page.getByTestId('list-grid-delete-column').click()
  await expect(glide).toHaveAttribute('data-columns', '1')

  await pressUndo(page)
  await expect(glide).toHaveAttribute('data-columns', '2')
  await expect(glideCellText(glide, 0, 1)).toHaveText('1')
  await expect(glideCellText(glide, 1, 1)).toHaveText('3')

  await cleanup(page, id)
})

// The toast's Undo pops the delete step off the journal; a following ⌘Z
// walks back to the step made BEFORE the delete.
test('the toast’s Undo undoes the delete, and ⌘Z then walks back further', async ({ page }) => {
  await page.goto('/')
  const id = await seedList(page, 'E2E toast undo journal', TWO_ROWS)
  await openListsInventory(page)

  // A recorded step to land beneath the delete: one cell edit.
  const glide = await openGrid(page, 'E2E toast undo journal')
  await editGlideCell(page, glide, 0, 0, 'Bolt v2')
  await expect(glideCellText(glide, 0, 0)).toHaveText('Bolt v2')
  await page.getByRole('button', { name: 'Close' }).click()

  const row = listRow(page, 'E2E toast undo journal')
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
  const toast = page.getByTestId('undo-delete-toast')
  await expect(toast).toContainText('Deleted "E2E toast undo journal"')
  await toast.getByTestId('undo-delete-toast-button').click()
  await expect(toast).toHaveCount(0)
  await expect(row).toBeVisible()

  // The delete is off the journal, so ⌘Z undoes the cell edit under it.
  await pressUndo(page)
  const reopened = await openGrid(page, 'E2E toast undo journal')
  await expect(glideCellText(reopened, 0, 0)).toHaveText('Bolt')

  await cleanup(page, id)
})

// ⌘Z within the toast's window resolves the delete: the entity is back
// and the toast hides, since the journal's top step is no longer it.
test('⌘Z within the toast’s window restores the entity and hides the toast', async ({ page }) => {
  await page.goto('/')
  const id = await seedList(page, 'E2E undo hides toast', TWO_ROWS)
  await openListsInventory(page)

  const row = listRow(page, 'E2E undo hides toast')
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
  const toast = page.getByTestId('undo-delete-toast')
  await expect(toast).toContainText('Deleted "E2E undo hides toast"')

  // The design-pass artifact for goal 0352 part 2: the toast beside the
  // delete it offers to undo. Opt-in so CI never writes outside its own
  // artifacts directory.
  if (process.env.MILL_E2E_SHOT_DIR) {
    await page.screenshot({ path: `${process.env.MILL_E2E_SHOT_DIR}/toast-undo.png` })
  }

  await pressUndo(page)
  await expect(row).toBeVisible()
  await expect(toast).toHaveCount(0)

  await cleanup(page, id)
})
