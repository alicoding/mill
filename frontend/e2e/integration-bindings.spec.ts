import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import { workflowRow, activePanel, dragPaletteItemToCanvas, connectNodes } from './fixtures/canvas'
import { clickCanvasNode } from './fixtures/canvasNode'

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

function requestRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="request"]').filter({ has: page.getByText(label, { exact: true }) })
}

test('Matching an Integration node to a declared operation shows a binding editor with a secret field guarded', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByTestId('new-integration').click()
  await page.getByTestId('new-integration-rest').click()
  await page.getByLabel('Label').fill('E2E bindings request')
  await page.getByLabel('URL', { exact: true }).fill('https://api.example.com')
  await page.getByTestId('toggle-raw-openapi').click()
  await page.getByTestId('request-openapi-spec').fill(bindingSpec)
  await page.getByRole('button', { name: 'Save request' }).click()
  await expect(requestRow(page, 'E2E bindings request')).toBeVisible()

  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  // Keeps the starter trigger-manual node -- docs/adr/0028 requires a
  // Trigger root, so Integration alone can no longer be the whole graph.
  await dragPaletteItemToCanvas(page, 'integration-http')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)
  await connectNodes(page, 'Trigger: manual', 'Integration: HTTP call')
  await clickCanvasNode(page, activePanel(page), 'Integration: HTTP call')

  const inspector = activePanel(page).getByTestId('composition-inspector')
  await inspector.getByTestId('entity-ref-field').selectOption({ label: 'E2E bindings request' })

  // No path/method to fill -- transport lives on the integration
  // itself now (its single declared operation), and the bindings
  // editor resolves it automatically once the integration is picked.
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

  await clickRowAction(page, workflowRow(page, 'E2E bindings workflow'), 'Delete')
  await expect(workflowRow(page, 'E2E bindings workflow')).toHaveCount(0)

  await page.getByRole('link', { name: 'Configure' }).click()
  await clickRowAction(page, requestRow(page, 'E2E bindings request').first(), 'Delete')
  await expect(requestRow(page, 'E2E bindings request')).toHaveCount(0)
})
