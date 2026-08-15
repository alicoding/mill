import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// The step designer's real task sentence (.claude/rules/testing.md):
// can a user create a named step type from a configured integration and
// use it on a canvas, without touching code -- and does it reach an
// already-open palette live, the same way every other Configure entity
// already does (ADR-0037, goal 0054 slice B). Two pages in the SAME
// browser context (not two Playwright workers -- this worker's one
// mill-server serves both): pageA keeps a new workflow's palette open
// for the whole test and never navigates away, so its live update can
// only come from the `mill-data-changed` event this entity now emits
// into, never from a remount re-fetching fresh data (the trap a
// switch-tabs-and-back test would fall into, since CompositionView
// already refetches NodeTypes on every mount regardless of live sync).
// pageB drives every Configure mutation. Deletes what it creates
// (within-file discipline, testing.md) -- this worker's palette-count
// assertions elsewhere (node-palette.spec.ts, composition.spec.ts) stay
// pinned to the 32 built-in+seeded total for the rest of the run.

function activePanel(page: Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

function exactText(label: string): RegExp {
  return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
}

async function dragPaletteItemByLabelToCanvas(page: Page, label: string) {
  const panel = activePanel(page)
  const item = panel.locator('[data-testid="palette-item"]').filter({ hasText: exactText(label) })
  await item.evaluate((paletteEl) => {
    const canvas = paletteEl.closest('[role="tabpanel"]')?.querySelector('.react-flow__pane')
    if (!canvas) throw new Error('no canvas in the active panel')
    const dataTransfer = new DataTransfer()
    const rect = canvas.getBoundingClientRect()
    const clientX = rect.x + rect.width / 2
    const clientY = rect.y + rect.height / 2
    paletteEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }))
  })
}

async function clickCanvasNode(page: Page, panel: import('@playwright/test').Locator, label: string) {
  const node = panel.locator('.react-flow__node').filter({ hasText: label })
  const box = await node.boundingBox()
  if (!box) throw new Error(`clickCanvasNode: node "${label}" has no bounding box`)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

async function openStepTypesTab(page: Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Step types', exact: true }).click()
}

async function cleanupStepType(configPage: Page, label: string) {
  const row = configPage.locator('[data-testid="inventory-row"][data-entity="steptype"]').filter({ has: configPage.getByText(label, { exact: true }) })
  if (await row.count()) {
    await clickRowAction(configPage, row, 'Delete')
    await expect(row).not.toBeVisible()
  }
}

test('step designer: create over the seeded integration reaches an already-open palette live, drops with only unpinned fields, edit/delete stay live', async ({ page, context }) => {
  const LABEL = 'E2E Step Designer HTTP'
  const RENAMED = 'E2E Step Designer HTTP renamed'

  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  const panel = activePanel(page)
  await expect(panel.locator('[data-testid="palette-item"]').filter({ hasText: exactText(LABEL) })).toHaveCount(0)

  const configPage = await context.newPage()
  await openStepTypesTab(configPage)

  try {
    await configPage.getByTestId('new-steptype').click()
    await configPage.getByTestId('steptype-label').fill(LABEL)
    await configPage.getByTestId('steptype-palette-group').selectOption('data')
    // Engine defaults to "An HTTP request" -- bind it to the seeded
    // no-auth httpbin request (Slice A's own seeded proof, ADR-0037).
    await configPage.getByTestId('entity-ref-field').selectOption({ label: 'Example: No auth (httpbin.org)' })
    await expect(configPage.getByText("Nothing to pin for this binding -- every field it needs is set above.")).toBeVisible()
    await configPage.getByTestId('save-steptype').click()

    const row = configPage.locator('[data-testid="inventory-row"][data-entity="steptype"]').filter({ has: configPage.getByText(LABEL, { exact: true }) })
    await expect(row).toBeVisible()

    // pageA's already-open palette picks it up live -- no reload, no
    // remount, correct display group (its own PaletteGroup, not the
    // Kind fallback every declared type would otherwise land in).
    const item = panel.locator('[data-testid="palette-item"]').filter({ hasText: exactText(LABEL) })
    await expect(item).toBeVisible({ timeout: 10_000 })
    const group = panel.locator('[data-testid="palette-group"][data-group-id="data"]')
    await expect(group.locator('[data-testid="palette-item"]').filter({ hasText: exactText(LABEL) })).toBeVisible()

    // Dropped onto canvas, its config shows only the unpinned fields --
    // here, none: the engine's one field (requestId) is its own binding,
    // always force-hidden, and integration-http has no other ConfigField.
    await dragPaletteItemByLabelToCanvas(page, LABEL)
    await expect(panel.locator('.react-flow__node').filter({ hasText: LABEL })).toBeVisible()
    await clickCanvasNode(page, panel, LABEL)
    const inspector = panel.getByTestId('composition-inspector')
    await expect(inspector).toBeVisible()
    await expect(inspector.getByText('No configuration')).toBeVisible()

    // Editing the label reaches the open palette live too.
    await row.click()
    await configPage.getByTestId('steptype-label').fill(RENAMED)
    await configPage.getByTestId('save-steptype').click()
    await expect(panel.locator('[data-testid="palette-item"]').filter({ hasText: exactText(RENAMED) })).toBeVisible({ timeout: 10_000 })
    await expect(panel.locator('[data-testid="palette-item"]').filter({ hasText: exactText(LABEL) })).toHaveCount(0)

    // Deleting (with confirm) removes it from the open palette live too.
    const renamedRow = configPage.locator('[data-testid="inventory-row"][data-entity="steptype"]').filter({ has: configPage.getByText(RENAMED, { exact: true }) })
    await clickRowAction(configPage, renamedRow, 'Delete')
    await expect(renamedRow).not.toBeVisible()
    await expect(panel.locator('[data-testid="palette-item"]').filter({ hasText: exactText(RENAMED) })).toHaveCount(0, { timeout: 10_000 })
  } finally {
    await cleanupStepType(configPage, RENAMED)
    await cleanupStepType(configPage, LABEL)
    await configPage.close()
  }
})

// The pin-vs-free half of the designer form, over a richer engine (a
// callable workflow has real pinnable fields beyond its own binding,
// unlike the HTTP case above): a pinned field is locked and dropped
// from a dropped node's own config entirely; an unpinned field of the
// same engine stays author-editable, same as any ordinary ConfigField.
test('step designer: a pinned field is locked and hidden on the dropped node; an unpinned field of the same engine stays editable', async ({ page }) => {
  const LABEL = 'E2E Step Designer Workflow'

  await openStepTypesTab(page)
  await page.getByTestId('new-steptype').click()
  await page.getByTestId('steptype-label').fill(LABEL)
  await page.getByTestId('steptype-palette-group').selectOption('flow')
  await page.getByTestId('steptype-binding-kind').selectOption('workflow')
  await page.getByTestId('entity-ref-field').selectOption({ label: 'Example: Echo message (callable child)' })

  const pinIdempotency = page.getByRole('checkbox', { name: 'Pin Skip duplicate runs (optional)' })
  await pinIdempotency.check()
  await page.getByRole('textbox', { name: 'Skip duplicate runs (optional)' }).fill('e2e-fixed-key')
  await page.getByTestId('save-steptype').click()

  const row = page.locator('[data-testid="inventory-row"][data-entity="steptype"]').filter({ has: page.getByText(LABEL, { exact: true }) })
  await expect(row).toBeVisible()

  try {
    await page.getByRole('link', { name: 'Workflows' }).click()
    await page.getByTestId('new-workflow').click()
    await activePanel(page).getByTestId('toggle-palette').click()
    const panel = activePanel(page)
    await expect(panel.locator('[data-testid="palette-item"]').filter({ hasText: exactText(LABEL) })).toBeVisible()

    await dragPaletteItemByLabelToCanvas(page, LABEL)
    await expect(panel.locator('.react-flow__node').filter({ hasText: LABEL })).toBeVisible()
    await clickCanvasNode(page, panel, LABEL)
    const inspector = panel.getByTestId('composition-inspector')
    await expect(inspector).toBeVisible()

    // The pinned field never appears as an author-editable control.
    await expect(inspector.getByText('Skip duplicate runs (optional)')).toHaveCount(0)
    // The unpinned fields of the SAME engine still do.
    await expect(inspector.getByText('Pin to version (optional)')).toBeVisible()
    await expect(inspector.getByText('Store result in attribute (optional)')).toBeVisible()
  } finally {
    await page.getByRole('link', { name: 'Configure' }).click()
    await page.getByRole('tab', { name: 'Step types', exact: true }).click()
    await cleanupStepType(page, LABEL)
  }
})
