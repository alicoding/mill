// Reference fields open what they reference (goal 0312): Details peeks
// at the chosen entity in place, Open lands on its own editor, and an
// entity that cannot work (an integration whose auth has no secret)
// says so on the field. Shared worker pool: this file creates and
// deletes its own integration and reads only the seeded list.
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/server'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { clickCanvasNode } from './fixtures/canvasNode'
import { activePanel, dragPaletteItemToCanvas } from './fixtures/canvas'

const CONFIGURE = 'github.com/alicoding/mill/internal/services/configuresvc.ConfigureService.'

async function openPaletteOnNewWorkflow(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
}

test('an integration without its secret says so on the step, Details shows its address, and Open lands on its editor tab', async ({ page }) => {
  await page.goto('/')
  const created = await callBindingViaRPC<{ ID: string }>(page, CONFIGURE + 'CreateHTTPRequest', ['ZzE2ePeekJira', 'https://jira.example.com', '', '', 'bearer', '', {}, '', null, null, ''])
  try {
    await openPaletteOnNewWorkflow(page)
    await dragPaletteItemToCanvas(page, 'integration-http')
    const panel = activePanel(page)
    await clickCanvasNode(page, panel, 'Call an API')
    await panel.getByTestId('entity-ref-field').first().selectOption({ label: 'ZzE2ePeekJira' })

    const peek = panel.getByTestId('entity-ref-peek').first()
    await expect(peek.getByTestId('entity-ref-problem')).toContainText('No secret is chosen for this auth')
    await peek.getByTestId('entity-ref-details').click()
    const summary = peek.getByTestId('entity-ref-summary')
    await expect(summary).toContainText('Address')
    await expect(summary).toContainText('https://jira.example.com')
    await expect(summary).toContainText('Bearer token')
    await expect(summary).toContainText('Missing')

    await peek.getByTestId('entity-ref-open').click()
    // The integration's own editor opens as a work tab beside the
    // workflow; the workflow tab stays to return to.
    await expect(page.getByRole('tab', { name: /ZzE2ePeekJira/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: /New workflow/ })).toBeVisible()
  } finally {
    await callBindingViaRPC(page, CONFIGURE + 'DeleteHTTPRequest', [created.ID])
  }
})

test('a list reference peeks at its columns and Open lands on that list\'s editor in Configure', async ({ page }) => {
  await openPaletteOnNewWorkflow(page)
  await dragPaletteItemToCanvas(page, 'list-lookup')
  const panel = activePanel(page)
  await clickCanvasNode(page, panel, 'Look up list row')
  await panel.getByTestId('entity-ref-field').first().selectOption({ label: 'Country codes' })
  const peek = panel.getByTestId('entity-ref-peek').first()
  await expect(peek.getByTestId('entity-ref-problem')).toHaveCount(0)
  await peek.getByTestId('entity-ref-details').click()
  await expect(peek.getByTestId('entity-ref-summary')).toContainText('Columns')
  await peek.getByTestId('entity-ref-open').click()
  await expect(page.getByTestId('configure-lists')).toBeVisible()
  await expect(page.getByTestId('list-label')).toHaveValue('Country codes')
})
