import { test, expect } from './fixtures/server'
import { clickCanvasNode } from './fixtures/canvasNode'
import { activePanel, dragPaletteItemToCanvas } from './fixtures/canvas'
import { clickRowAction } from './inventoryRow'

// Workflow-canvas copy/paste clones (docs/goals/0153 slice 1): ⌘C on
// a selected step serializes it to the system clipboard as readable
// JSON; ⌘V pastes a fresh-ID clone at the cursor with its config.
// Trigger steps never copy. Shared worker pool: the workflow this
// file creates is deleted at the end.
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('copy/paste clones a step at the cursor; the trigger refuses', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  const panel = activePanel(page)
  await panel.getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'process-inject-text')
  await expect(panel.locator('.react-flow__node')).toHaveCount(2)
  // Close the palette so it can't overlap the dropped node.
  await panel.getByTestId('toggle-palette').click()

  // Copy the process step -- the hint names the copy.
  await clickCanvasNode(page, panel, 'Add text')
  await page.keyboard.press(`${mod}+c`)
  await expect(page.getByTestId('connection-refusal-hint')).toContainText('Copied 1 item')

  // Paste with the cursor parked at a far corner: the clone lands
  // there (a third node appears, selected, same label). This is a pure
  // cursor-position gesture, not an interaction -- the paste-anchor
  // logic reads the last window-level mousemove coordinate, which
  // bubbles regardless of what's on top of the pane at that pixel, so
  // Playwright's hit-target/stability check (what locator.hover()
  // demands) is the wrong tool here and made this test newly flaky
  // against the inspector panel legitimately covering part of the
  // pane -- confirmed live (goal 0184 migration probe).
  const pane = panel.locator('.react-flow__pane')
  const box = await pane.boundingBox()
  if (!box) throw new Error('canvas pane has no box')
  // eslint-disable-next-line no-restricted-syntax -- cursor-position-only gesture, not a checkable interaction (see comment above)
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75)
  await page.keyboard.press(`${mod}+v`)
  await expect(panel.locator('.react-flow__node')).toHaveCount(3)
  await expect(panel.locator('.react-flow__node', { hasText: 'Add text' })).toHaveCount(2)
  await expect(page.getByTestId('connection-refusal-hint')).toContainText('Pasted 1 item')
  // The pasted clone is the selection now.
  await expect(panel.locator('.react-flow__node.selected', { hasText: 'Add text' })).toHaveCount(1)

  // A trigger-only selection refuses with the reason.
  await clickCanvasNode(page, panel, 'Manual run')
  await page.keyboard.press(`${mod}+c`)
  await expect(page.getByTestId('connection-refusal-hint')).toContainText("trigger step can't be copied")

  // Cleanup (within-file discipline): remove both process nodes (the
  // clone is still selected from the paste; Delete takes it, then the
  // original), save the now-valid bare-trigger draft, delete its row.
  const addTexts = panel.locator('.react-flow__node', { hasText: 'Add text' })
  await addTexts.first().click()
  await page.keyboard.press('Backspace')
  await expect(addTexts).toHaveCount(1)
  await addTexts.first().click()
  await page.keyboard.press('Backspace')
  await expect(panel.locator('.react-flow__node')).toHaveCount(1)
  await panel.getByLabel('Label').fill('ZzE2eClipboardWf')
  await panel.getByTestId('save-workflow').click()
  const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ hasText: 'ZzE2eClipboardWf' }).first()
  await expect(row).toBeVisible()
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
})
