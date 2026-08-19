import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/server'
import { clickCanvasNode } from './fixtures/canvasNode'
import { activePanel, dragPaletteItemToCanvas } from './fixtures/canvas'
import { waitForViewportStable } from './fixtures/animation'

// Shared worker pool: every test here opens its own fresh, never-saved
// "New workflow" tab and only reads/asserts on nodes/edges it just
// created itself -- no global inventory state, no cross-test cleanup
// needed (an unsaved draft tab leaves nothing behind).
//
// Covers the step I/O contract's canvas/inspector surfacing (ADR-0042
// slice 2): the draw-time kind refusal + its explanation, the card's
// compact contract line, and the Inspector's full sentence. The TS
// mirror's own pure-function behavior is unit-tested in
// payloadKinds.test.ts / canvasConnectionRules.test.ts; this file
// proves the same behavior through the real UI.

async function openPaletteOnNewWorkflow(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
}

// Draws a real edge between the Nth and Mth dropped node, by canvas
// order -- not connectNodes' (fixtures/canvas.ts) own label-text filter,
// since this file deliberately drops two nodes sharing the exact same
// label ("Convert HTML to Markdown") to exercise the double-convert
// refusal, and a label filter can't disambiguate them. React Flow
// renders nodes in the store's own array order, which follows drop
// order (canvasStore.ts's addNode always appends), so index 0 is the
// starter trigger and each later index is a node in the order it was
// dropped.
async function connectByIndex(page: Page, sourceIndex: number, targetIndex: number): Promise<void> {
  const panel = activePanel(page)
  const sourceHandle = panel.locator('.react-flow__node').nth(sourceIndex).locator('.react-flow__handle.source')
  const targetHandle = panel.locator('.react-flow__node').nth(targetIndex).locator('.react-flow__handle.target')
  const sourceBox = await sourceHandle.boundingBox()
  const targetBox = await targetHandle.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('connectByIndex: handle bounding box not found')
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 })
  await page.mouse.up()
}

test('a kind-incompatible connection is refused with an explanation; a compatible one connects', async ({ page }) => {
  await openPaletteOnNewWorkflow(page)
  await dragPaletteItemToCanvas(page, 'capture-clipboard-html')
  await dragPaletteItemToCanvas(page, 'process-html-to-markdown')
  await dragPaletteItemToCanvas(page, 'process-html-to-markdown')

  const panel = activePanel(page)
  await panel.getByRole('button', { name: 'Fit View' }).click()
  await waitForViewportStable(panel)

  // capture (index 1, HTML) -> the first converter (index 2, needs
  // HTML): compatible, connects.
  await connectByIndex(page, 1, 2)
  await expect(panel.locator('.react-flow__edge')).toHaveCount(1)

  // The first converter (index 2, produces Markdown) -> the second
  // converter (index 3, needs HTML): the double-convert mistake
  // ADR-0042 exists to catch -- no new edge, and the hint explains why.
  await connectByIndex(page, 2, 3)
  await expect(panel.locator('.react-flow__edge')).toHaveCount(1)
  const hint = panel.getByTestId('connection-refusal-hint')
  await expect(hint).toBeVisible()
  await expect(hint).toContainText('needs HTML')
})

test('a canvas card shows its compact I/O contract line', async ({ page }) => {
  await openPaletteOnNewWorkflow(page)
  await dragPaletteItemToCanvas(page, 'process-html-to-markdown')

  const panel = activePanel(page)
  await panel.getByRole('button', { name: 'Fit View' }).click()
  await waitForViewportStable(panel)
  await expect(panel.locator('.react-flow__node').filter({ hasText: 'Convert HTML to Markdown' })).toContainText('HTML → Markdown')
})

test('the Inspector states the selected step\'s I/O contract in full', async ({ page }) => {
  await openPaletteOnNewWorkflow(page)
  await dragPaletteItemToCanvas(page, 'process-html-to-markdown')

  const panel = activePanel(page)
  await clickCanvasNode(page, panel, 'Convert HTML to Markdown')
  await expect(panel.getByTestId('inspector-io-contract')).toHaveText('Takes: HTML — Produces: Markdown')
})
