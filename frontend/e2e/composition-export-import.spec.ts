import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// Real Go bindings over HTTP (Wails3 server mode), not mocks -- same
// setup as composition.spec.ts, split into its own file once that file
// crossed the 500-line limit adding this coverage (CLAUDE.md). Workflow
// export/import (compositionservice_export.go): ExportWorkflow's own
// determinism/omitted-ID contract and ImportWorkflow's always-mint-a-
// new-workflow behavior (ADR-0013's Duplicate precedent).

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

test('Exporting a workflow downloads a portable JSON file with its real definition', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Load sample HTML')
  await expect(row).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await clickRowAction(page, row, 'Export')
  const download = await downloadPromise

  expect(download.suggestedFilename()).toBe('Load sample HTML.json')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'))

  expect(parsed.label).toBe('Load sample HTML')
  expect(Array.isArray(parsed.nodes)).toBe(true)
  expect(parsed.nodes.length).toBeGreaterThan(0)
  // ExportWorkflow's own contract: never carries the workflow's own ID
  // or builtIn flag -- ImportWorkflow always mints a new ID, and an
  // imported workflow is never a protected built-in.
  expect(parsed.id).toBeUndefined()
  expect(parsed.builtIn).toBeUndefined()
})

test('Importing a workflow file adds a new, independent workflow without touching the original', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const before = await workflowRow(page, 'Load sample HTML').count()

  const importJSON = JSON.stringify({
    label: 'E2E imported workflow',
    description: 'Imported by an e2e test',
    // A Trigger root (docs/adr/0028) -- a lone Capture node alone is
    // now the owner's own unsaveable repro.
    nodes: [
      { ID: 't', NodeTypeID: 'trigger-manual' },
      { ID: 'c', NodeTypeID: 'capture-clipboard-html' },
    ],
    edges: [{ ID: 'e1', Source: 't', Target: 'c' }],
    attributes: [],
  })
  await page.getByTestId('import-workflow').click()
  await page.getByTestId('import-workflow-input').setInputFiles({
    name: 'workflow.json',
    mimeType: 'application/json',
    buffer: Buffer.from(importJSON, 'utf-8'),
  })

  const importedRow = workflowRow(page, 'E2E imported workflow')
  await expect(importedRow).toBeVisible()
  await expect(importedRow.getByText('Imported by an e2e test')).toBeVisible()
  // The original this could theoretically have come from is untouched --
  // proves import always creates independently, never updates in place.
  await expect(workflowRow(page, 'Load sample HTML')).toHaveCount(before)

  await clickRowAction(page, importedRow, 'Delete')
  await expect(workflowRow(page, 'E2E imported workflow')).toHaveCount(0)
})

test('Importing invalid JSON shows an error instead of silently failing', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  await page.getByTestId('import-workflow').click()
  await page.getByTestId('import-workflow-input').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('not valid json', 'utf-8'),
  })

  await expect(page.getByTestId('import-workflow-error')).toBeVisible()
})
