import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import { workflowRow, activePanel, dragNodeBy } from './fixtures/canvas'

// Canvas note block (docs/goals/0055): a free-floating authoring-space
// annotation, deliberately NOT a step -- no ports, excluded from the
// step palette, invisible to execution. Split into its own file rather
// than composition-canvas-interactions.spec.ts (already near the
// 500-line limit, CLAUDE.md), same "split along a real seam" discipline
// this suite already follows.

test('canvas note: add, edit, persist across reload, drag, delete -- never a step, never in the palette, never affects Run', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  const panel = activePanel(page)

  // Not in the step palette: NodePalette.tsx only ever renders real
  // NodeType entries (composition.NodeTypes()), which a Note is
  // structurally excluded from (it has no Kind/NodeTypeID at all).
  await panel.getByTestId('toggle-palette').click()
  await expect(panel.locator('[data-node-type-id*="note" i]')).toHaveCount(0)

  // Add via the canvas toolbar, not the palette.
  await panel.getByTestId('add-note').click()
  const noteCard = panel.locator('.react-flow__node:has([data-testid="canvas-note-text"])')
  await expect(noteCard).toBeVisible()

  // Double-click enters inline text editing -- a separate handler from
  // a step card's own double-click (which opens the step-detail
  // overlay); no overlay should appear here.
  await noteCard.dblclick()
  const textarea = panel.getByLabel('Note text')
  await expect(textarea).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await textarea.fill('Documents this workflow')
  await textarea.blur()
  await expect(noteCard).toContainText('Documents this workflow')

  // Dragging moves it (a real mouse gesture, same shape connectNodes
  // elsewhere in this suite uses for React Flow's own pointer handling).
  const before = await noteCard.boundingBox()
  if (!before) throw new Error('note card has no bounding box before drag')
  await dragNodeBy(page, noteCard, 120, 80)
  const after = await noteCard.boundingBox()
  if (!after) throw new Error('note card has no bounding box after drag')
  expect(Math.abs(after.x - before.x) > 20 || Math.abs(after.y - before.y) > 20).toBe(true)

  await panel.getByLabel('Label').fill('E2E note workflow')
  await panel.getByTestId('save-workflow').click()

  // Save closes the editor tab (app/WorkTabShell.tsx's onSaved) --
  // reopen it via a row click so the canvas's own Run button (only
  // rendered for an already-saved workflow) is reachable.
  const row = workflowRow(page, 'E2E note workflow')
  await expect(row).toBeVisible()
  await row.click()
  const reopened = activePanel(page)

  // Persists across the reload above: same text, still exactly one note.
  const reopenedNote = reopened.locator('.react-flow__node:has([data-testid="canvas-note-text"])')
  await expect(reopenedNote).toContainText('Documents this workflow')
  await expect(reopenedNote).toHaveCount(1)

  // Run never sees the note as a step: this workflow is trigger-only, so
  // a completed run produces exactly one run-status badge (the trigger),
  // and the note's own card gets none at all.
  await reopened.getByTestId('canvas-run').click()
  const triggerStatus = reopened.locator('.react-flow__node').filter({ hasText: 'Manual run' }).getByTestId('node-run-status')
  await expect(triggerStatus).toHaveAttribute('data-status', 'done', { timeout: 10_000 })
  await expect(reopened.getByTestId('node-run-status')).toHaveCount(1)
  await expect(reopenedNote.getByTestId('node-run-status')).toHaveCount(0)

  // A reopened row lands in view mode (docs/goals/0022) -- no
  // delete-selected/save affordance until switched to edit.
  await reopened.getByTestId('edit-workflow').click()

  // Selecting and deleting it removes it from the canvas.
  await reopenedNote.click()
  await reopened.getByRole('button', { name: 'Delete selected' }).click()
  await expect(reopened.getByTestId('canvas-note-text')).toHaveCount(0)
  await reopened.getByTestId('save-workflow').click()

  await page.getByRole('link', { name: 'Workflows' }).click()
  await clickRowAction(page, workflowRow(page, 'E2E note workflow'), 'Delete')
  await expect(workflowRow(page, 'E2E note workflow')).toHaveCount(0)
})
