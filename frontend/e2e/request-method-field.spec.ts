import { test, expect } from '@playwright/test'

// Exercises ADR-0016 Phase B/C: integration-http's Method field is an
// open TextInput with a datalist of suggestions, not a closed Select --
// any value (including RFC 10008's QUERY, not one of the old 5-item
// list) is accepted and persists, over real Go bindings (Wails3 server
// mode), not mocks.

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

async function deleteStarterNode(page: import('@playwright/test').Page) {
  await activePanel(page).locator('.react-flow__node').click()
  await activePanel(page).getByRole('button', { name: 'Delete selected' }).click()
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(0)
}

test('The Method field accepts QUERY, an offered suggestion outside the old closed list, and persists it', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  await page.getByTestId('new-workflow').click()
  await deleteStarterNode(page)
  await activePanel(page).getByTestId('toggle-palette').click()

  await dragPaletteItemToCanvas(page, 'integration-http')
  await activePanel(page).locator('.react-flow__node').click()

  const inspector = activePanel(page).getByTestId('composition-inspector')
  const methodField = inspector.getByTestId('canvas-config-field').nth(1)

  // Not a closed Select -- a plain text input.
  await expect(methodField).toHaveJSProperty('tagName', 'INPUT')

  // QUERY is offered as a suggestion via the field's datalist, not
  // required to type blind.
  const listId = await methodField.getAttribute('list')
  expect(listId).toBeTruthy()
  const datalist = inspector.locator(`datalist#${listId}`)
  await expect(datalist.locator('option[value="QUERY"]')).toHaveCount(1)

  await methodField.fill('QUERY')
  await methodField.blur()

  // Save and reopen via Edit -- the real "did it persist in Node.Config,
  // not just left in the input's own local DOM state" proof, same
  // pattern composition.spec.ts's own save-then-reopen tests already
  // use, rather than a same-tab reselect (which the canvas toolbar's
  // top-left docking makes fiddly to click around).
  await activePanel(page).getByLabel('Label').fill('E2E QUERY method workflow')
  await activePanel(page).getByTestId('save-workflow').click()

  const row = workflowRow(page, 'E2E QUERY method workflow')
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: /Edit/ }).click()
  await activePanel(page).locator('.react-flow__node').click()
  await expect(activePanel(page).getByTestId('canvas-config-field').nth(1)).toHaveValue('QUERY')

  await page.getByRole('tab', { name: 'Workflows' }).click()
  await row.getByRole('button', { name: /Delete/ }).click()
  await expect(row).toHaveCount(0)
})
