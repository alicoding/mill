import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import { workflowRow, activePanel, dragPaletteItemToCanvas, connectNodes } from './fixtures/canvas'
import { clickCanvasNode } from './fixtures/canvasNode'

// Exercises ADR-0009's live picker + inline quick-create: integration-
// http's requestId field (RefKind: "request") renders as a Select
// with a "+ Create new request…" option instead of a raw paste-an-ID
// text box, over real Go bindings (Wails3 server mode), not mocks.
//
// Deletes both the workflow AND the request it creates -- the
// request is a real, separately-persisted Configure entity (same
// shared-settings-file accumulation risk configure-requests.spec.ts's
// own header comment already documents), not something workflow
// deletion cleans up on its own.

function requestRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="request"]').filter({ has: page.getByText(label, { exact: true }) })
}

test('Selecting an Integration node offers a live request picker with inline quick-create', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()

  // Keeps the starter trigger-manual node -- docs/adr/0028 requires a
  // Trigger root, so Integration alone can no longer be the whole graph.
  await dragPaletteItemToCanvas(page, 'integration-http')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)
  await connectNodes(page, 'Manual run', 'Call an API')

  await clickCanvasNode(page, activePanel(page), 'Call an API')
  const inspector = activePanel(page).getByTestId('composition-inspector')
  await expect(inspector).toContainText('Integration')

  const picker = inspector.getByTestId('entity-ref-field')
  await expect(picker).toBeVisible()
  await picker.selectOption({ label: '+ Create new request…' })

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Label').fill('E2E picker request')
  await dialog.getByLabel('URL', { exact: true }).fill('https://api.example.com')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(dialog).toHaveCount(0)

  // The picker auto-selected the newly created request -- not left on
  // "Select a request…" or reverted to empty.
  await expect(picker).not.toHaveValue('')
  await expect(picker.locator('option:checked')).toHaveText('E2E picker request')

  await activePanel(page).getByLabel('Label').fill('E2E picker workflow')
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(workflowRow(page, 'E2E picker workflow')).toBeVisible()

  // Cleanup: the workflow, then the request it created.
  await clickRowAction(page, workflowRow(page, 'E2E picker workflow'), 'Delete')
  await expect(workflowRow(page, 'E2E picker workflow')).toHaveCount(0)

  await page.getByRole('link', { name: 'Configure' }).click()
  await clickRowAction(page, requestRow(page, 'E2E picker request'), 'Delete')
  await expect(requestRow(page, 'E2E picker request')).toHaveCount(0)
})

// docs/goals/0066: RefKind "atlas-kind" reuses this exact picker
// mechanism (EntityRefField's fetchEntities switch, .../configure/
// EntityRefField.tsx), pointed at AtlasService.Kinds() -- no quick-
// create for v1 (Atlas already has its own Kind-authoring flow, ADR-
// 0038), unlike the request picker above. Selecting the seeded
// "Client request intake" workflow's real apply-atlas-card-update node
// proves both the picker AND the Kind-driven field editor
// (AtlasFieldBindingsEditor) render from the real seeded Intake Kind.
test('Selecting the Update Atlas card node offers a live Kind picker and the Kind-driven field editor', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await workflowRow(page, 'Client request intake').click()

  await clickCanvasNode(page, activePanel(page), 'Update Atlas card')
  const inspector = activePanel(page).getByTestId('composition-inspector')
  await expect(inspector).toContainText('Update Atlas card')

  // View mode (a row click opens the workflow read-only) shows the
  // reference's VALUE with an Edit link (goal 0297); the link switches
  // the tab to edit, where the live picker appears with that value.
  const readOnlyValue = inspector.getByTestId('entity-ref-readonly')
  await expect(readOnlyValue).toContainText('Intake')
  await expect(inspector.getByTestId('entity-ref-field')).toHaveCount(0)
  await readOnlyValue.getByTestId('entity-ref-edit').click()
  const picker = inspector.getByTestId('entity-ref-field')
  await expect(picker).toBeVisible()
  await expect(picker.locator('option:checked')).toHaveText('Intake')

  const editor = inspector.getByTestId('atlas-field-bindings-editor')
  await expect(editor).toBeVisible()
  await expect(editor).toContainText('Status')
})
