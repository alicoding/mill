import { test, expect } from '@playwright/test'

// Exercises ADR-0007 Phase 3: once integration-http's requestId/path/
// method match a declared operation on the request's OpenAPI spec, the
// canvas Inspector renders a real binding editor (IntegrationBindingsEditor.tsx)
// instead of leaving bodyTemplate as the only option -- over real Go
// bindings (Wails3 server mode), not mocks.
//
// Deletes both the workflow and the request it creates -- same
// shared-settings-file accumulation risk configure-requests.spec.ts's
// own header comment documents.

const bindingSpec = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Widgets', version: '1.0.0' },
  paths: {
    '/widgets/{id}': {
      post: {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { note: { type: 'string' } } } } } },
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { name: { type: 'string' }, token: { type: 'string', format: 'password' } } },
              },
            },
          },
        },
      },
    },
  },
})

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="workflow-row"]', { has: page.getByText(label, { exact: true }) })
}

// .last(), not a bare match: a saved workflow's editor tab now nests a
// second Canvas/Runs tab bar inside the outer per-workflow tab
// (docs/SPEC.md §7's Update), so up to two [role="tabpanel"]:not([hidden])
// elements can be visible at once (the outer workflow tab, the inner
// Canvas/Runs one) -- document order always puts the outer one first,
// so .last() reliably resolves to the innermost, most specific panel
// regardless of whether a workflow has an inner tab bar or not.
function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

function requestRow(page: import('@playwright/test').Page, label: string) {
  return page.getByTestId('request-row').filter({ has: page.getByText(label, { exact: true }) })
}

async function dragPaletteItemToCanvas(page: import('@playwright/test').Page, nodeTypeID: string) {
  await page.evaluate((id) => {
    const panel = document.querySelector('[role="tabpanel"]:not([hidden])')
    if (!panel) throw new Error('no active tabpanel')
    const palette = panel.querySelector(`[data-node-type-id="${id}"]`)
    const canvas = panel.querySelector('.react-flow__pane')
    if (!palette || !canvas) throw new Error(`drag setup failed: palette found=${!!palette} canvas found=${!!canvas}`)
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

test('Matching an Integration node to a declared operation shows a binding editor with a secret field guarded', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('E2E bindings request')
  await page.getByLabel('Base URL').fill('https://api.example.com')
  await page.getByTestId('request-openapi-spec').fill(bindingSpec)
  await page.getByRole('button', { name: 'Save request' }).click()
  await expect(requestRow(page, 'E2E bindings request')).toBeVisible()

  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await deleteStarterNode(page)
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'integration-http')
  await activePanel(page).locator('.react-flow__node').click()

  const inspector = activePanel(page).getByTestId('composition-inspector')
  await inspector.getByTestId('entity-ref-field').selectOption({ label: 'E2E bindings request' })

  const configFields = inspector.getByTestId('canvas-config-field')
  await configFields.nth(0).fill('/widgets/{id}') // path
  await configFields.nth(0).blur()
  // Method is an open TextInput with a datalist of suggestions, not a
  // closed Select (ADR-0016) -- fill/blur, not selectOption.
  await configFields.nth(1).fill('POST') // method
  await configFields.nth(1).blur()

  const editor = inspector.getByTestId('integration-bindings-editor')
  await expect(editor).toBeVisible()
  await expect(editor).toContainText('id')
  await expect(editor).toContainText('note')
  await expect(editor).toContainText('name')
  // The secret output field is labeled, not offered as a bindable Select.
  await expect(editor).toContainText('token')
  await expect(editor).toContainText('secret')
  await expect(editor).toContainText('Secret fields cannot be written to an Attribute.')

  await inspector.getByLabel('id literal value').fill('w-42')
  await inspector.getByLabel('note literal value').fill('hello')

  await activePanel(page).getByLabel('Label').fill('E2E bindings workflow')
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(workflowRow(page, 'E2E bindings workflow')).toBeVisible()

  await workflowRow(page, 'E2E bindings workflow').getByRole('button', { name: /Delete/ }).click()
  await expect(workflowRow(page, 'E2E bindings workflow')).toHaveCount(0)

  await page.getByRole('link', { name: 'Configure' }).click()
  await requestRow(page, 'E2E bindings request').first().getByRole('button', { name: 'Delete E2E bindings request' }).click()
  await expect(requestRow(page, 'E2E bindings request')).toHaveCount(0)
})
