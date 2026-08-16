import { test, expect } from './fixtures/server'
import { activePanel, dragPaletteItemToCanvas } from './fixtures/canvas'

// The integration-http node asks ONLY for which integration to call --
// no path/method/body fields at the workflow level (direct user
// decision: transport config belongs on the Integration in Configure;
// the node just picks it and binds data). Method/endpoint/body
// authoring is covered at the request level by
// request-form-intake.spec.ts; legacy nodes persisted with their own
// path/method config still execute (Go-side regression tests cover
// that precedence).

async function deleteStarterNode(page: import('@playwright/test').Page) {
  await activePanel(page).locator('.react-flow__node').click()
  await activePanel(page).getByRole('button', { name: 'Delete selected' }).click()
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(0)
}

test('An Integration node offers only the integration picker -- no transport/body fields', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await deleteStarterNode(page)
  await activePanel(page).getByTestId('toggle-palette').click()

  await dragPaletteItemToCanvas(page, 'integration-http')
  await activePanel(page).locator('.react-flow__node').click()

  const inspector = activePanel(page).getByTestId('composition-inspector')
  // The integration picker is there (a live entity Select, ADR-0009)...
  await expect(inspector.getByTestId('entity-ref-field')).toBeVisible()
  // ...and nothing else asks for transport or body: requestId is the
  // node's only ConfigField, and it renders as the picker above, so no
  // generic config inputs remain at all.
  await expect(inspector.getByTestId('canvas-config-field')).toHaveCount(0)
  await expect(inspector.getByText('Method', { exact: true })).toHaveCount(0)
  await expect(inspector.getByText('Path', { exact: true })).toHaveCount(0)

  // Nothing was saved -- close the unsaved tab; no cleanup needed.
})
