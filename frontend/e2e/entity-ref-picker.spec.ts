import { test, expect } from '@playwright/test'

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

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="workflow-row"]', { has: page.getByText(label, { exact: true }) })
}

function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])')
}

async function dragPaletteItemToCanvas(page: import('@playwright/test').Page, nodeTypeID: string) {
  await page.evaluate((id) => {
    const panel = document.querySelector('[role="tabpanel"]:not([hidden])')
    if (!panel) throw new Error('no active tabpanel')
    const palette = panel.querySelector(`[data-node-type-id="${id}"]`)
    const canvas = panel.querySelector('.react-flow__pane')
    if (!palette || !canvas) {
      throw new Error(`drag setup failed: palette found=${!!palette} canvas found=${!!canvas}`)
    }
    const dataTransfer = new DataTransfer()
    const rect = canvas.getBoundingClientRect()
    const clientX = rect.x + rect.width / 2
    const clientY = rect.y + rect.height / 2
    palette.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }))
  }, nodeTypeID)
}

function requestRow(page: import('@playwright/test').Page, label: string) {
  return page.getByTestId('request-row').filter({ has: page.getByText(label, { exact: true }) })
}

// Removes the pre-populated starter node so only the dropped node exists
// -- a center-dropped node can otherwise land under the canvas's own
// bottom-right minimap overlay and intercept the click, same reasoning
// composition.spec.ts's own deleteStarterNode already established.
async function deleteStarterNode(page: import('@playwright/test').Page) {
  await activePanel(page).locator('.react-flow__node').click()
  await activePanel(page).getByRole('button', { name: 'Delete selected' }).click()
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(0)
}

test('Selecting an Integration node offers a live request picker with inline quick-create', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  await page.getByTestId('new-workflow').click()
  await deleteStarterNode(page)
  await activePanel(page).getByTestId('toggle-palette').click()

  await dragPaletteItemToCanvas(page, 'integration-http')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(1)

  await activePanel(page).locator('.react-flow__node').click()
  const inspector = activePanel(page).getByTestId('composition-inspector')
  await expect(inspector).toContainText('Request ID')

  const picker = inspector.getByTestId('entity-ref-field')
  await expect(picker).toBeVisible()
  await picker.selectOption({ label: '+ Create new request…' })

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Label').fill('E2E picker request')
  await dialog.getByLabel('Base URL').fill('https://api.example.com')
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
  await workflowRow(page, 'E2E picker workflow').getByRole('button', { name: /Delete/ }).click()
  await expect(workflowRow(page, 'E2E picker workflow')).toHaveCount(0)

  await page.getByRole('link', { name: 'Configure' }).click()
  await requestRow(page, 'E2E picker request').getByRole('button', { name: 'Delete E2E picker request' }).click()
  await expect(requestRow(page, 'E2E picker request')).toHaveCount(0)
})
