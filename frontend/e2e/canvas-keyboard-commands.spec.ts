import { test, expect } from './fixtures/server'
import { activePanel, dragPaletteItemToCanvas } from './fixtures/canvas'
import { clickCanvasNode } from './fixtures/canvasNode'

// Canvas undo/redo/delete/zoom keyboard commands (docs/goals/0162 item
// 2, shared/canvasCommands.ts): undo/redo/delete/zoom were toolbar-only
// before this, with zero keyboard or palette reach. Every workflow this
// file opens is a fresh, never-saved draft (openWorkTab's own starter
// graph) -- no server-side row is ever created, so there's nothing to
// delete at the end (unlike a spec that Saves).
//
// Always 'Meta', never a process.platform-conditional mod (unlike
// canvas-clipboard.spec.ts's own ⌘C/⌘V, which reach the browser's
// native copy/paste events and so need an OS-appropriate modifier):
// every shortcut this file presses -- undo/redo/zoom/palette-open --
// dispatches through shared/commands.ts's keymap system, whose
// defaultBinding is `mods: ['cmd']` throughout, by this whole
// registry's own established convention (every other keymap-dispatched
// spec -- keymap.spec.ts, atlas-jump.spec.ts, command-palette.spec.ts,
// help-overlay.spec.ts -- hardcodes 'Meta' the same way). Playwright's
// 'Meta' key name sets the browser event's metaKey flag regardless of
// the host OS the test runner itself is on, so branching on
// process.platform here only breaks CI's own Linux runner: 'Control'
// sets ctrlKey, which the mods:['cmd']-only dispatcher never matches.
const mod = 'Meta'

// Reads React Flow's own viewport transform ("translate(..) scale(S)"),
// the only place the live zoom is observable from the DOM -- same
// pattern mobile.spec.ts's own boardScale already uses for the Atlas
// board.
async function canvasScale(panel: ReturnType<typeof activePanel>): Promise<number> {
  return panel.locator('.react-flow__viewport').evaluate((el) => {
    const m = /scale\(([\d.]+)\)/.exec((el as HTMLElement).style.transform)
    return m ? Number(m[1]) : 1
  })
}

async function openNewWorkflow(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
}

// ⌘Z/⇧⌘Z drive the exact same zundo call the toolbar's own Undo/Redo
// buttons already drive (canvasActions.useCanvasStore.temporal, wired
// through useCanvasCommandDispatch) -- asserted here as a REAL revert
// (the node count actually goes back to 1, then back to 2), not just
// parity between the two trigger paths. A live guardrail/validation
// re-check landing in the same tick as undo/redo used to re-push the
// just-undone state back onto history and silently cancel the undo
// (docs/goals/0174, fixed via canvasStore.ts's withHistoryPaused) --
// this test would have caught that directly; the weaker
// toolbar-vs-keyboard-parity assertion it replaces would not have.
test('⌘Z drives the same undo the toolbar button drives; ⇧⌘Z drives the same redo', async ({ page }) => {
  async function editUndoRedo(trigger: 'toolbar' | 'keyboard') {
    await openNewWorkflow(page)
    const panel = activePanel(page)
    await panel.getByTestId('add-note').click()
    await expect(panel.locator('.react-flow__node')).toHaveCount(2)
    await page.waitForTimeout(500)

    if (trigger === 'toolbar') {
      await panel.getByRole('button', { name: 'Undo' }).click()
    } else {
      await page.keyboard.press(`${mod}+z`)
    }
    await expect(panel.locator('.react-flow__node')).toHaveCount(1)
    // The reactive guardrail/validation writers this goal fixed re-check
    // on a debounce; hold here so a still-in-flight one has its chance
    // to land before asserting the revert stuck.
    await page.waitForTimeout(500)
    const afterUndo = await panel.locator('.react-flow__node').count()

    if (trigger === 'toolbar') {
      await panel.getByRole('button', { name: 'Redo' }).click()
    } else {
      await page.keyboard.press(`${mod}+Shift+z`)
    }
    await expect(panel.locator('.react-flow__node')).toHaveCount(2)
    await page.waitForTimeout(500)
    const afterRedo = await panel.locator('.react-flow__node').count()
    return { afterUndo, afterRedo }
  }

  const viaToolbar = await editUndoRedo('toolbar')
  expect(viaToolbar).toEqual({ afterUndo: 1, afterRedo: 2 })
  const viaKeyboard = await editUndoRedo('keyboard')
  expect(viaKeyboard).toEqual({ afterUndo: 1, afterRedo: 2 })
})

// Backspace already deleted the selected node via React Flow's own
// deleteKeyCode default (CompositionCanvas.tsx); Delete did not -- the
// library's own default is 'Backspace' alone, not both keys, confirmed
// directly against its source before this fix widened
// CompositionCanvas.tsx's deleteKeyCode to ['Backspace', 'Delete'].
// canvas.delete (shared/canvasCommands.ts) exists for palette/
// Shortcuts-Help discoverability of the (now complete) binding.
test('Backspace and Delete both remove the selected canvas node', async ({ page }) => {
  await openNewWorkflow(page)
  const panel = activePanel(page)
  await panel.getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'process-inject-text')
  await expect(panel.locator('.react-flow__node')).toHaveCount(2)
  await panel.getByTestId('toggle-palette').click()

  await clickCanvasNode(page, panel, 'Add text')
  await page.keyboard.press('Backspace')
  await expect(panel.locator('.react-flow__node')).toHaveCount(1)

  await panel.getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'process-inject-text')
  await expect(panel.locator('.react-flow__node')).toHaveCount(2)
  await panel.getByTestId('toggle-palette').click()

  await clickCanvasNode(page, panel, 'Add text')
  // down/up with a real dwell, not .press(): React Flow's own
  // useKeyPress toggles a boolean pressed-state on down then up, and a
  // synthetic down+up pair fired back-to-back can collapse before
  // React ever commits the intermediate "pressed" render -- reproduced
  // directly (a bare .press('Delete') left the node undeleted while
  // the identical gesture on 'Backspace' never did). A real keypress
  // always has dwell time, so this is a synthetic-input artifact, not
  // a real-user-facing gap.
  await page.keyboard.down('Delete')
  await page.waitForTimeout(150)
  await page.keyboard.up('Delete')
  await expect(panel.locator('.react-flow__node')).toHaveCount(1)
})

test('Zoom in (⌘+) and zoom out (⌘-) change the canvas viewport scale', async ({ page }) => {
  await openNewWorkflow(page)
  const panel = activePanel(page)
  const initial = await canvasScale(panel)

  await page.keyboard.press(`${mod}+=`)
  await expect.poll(() => canvasScale(panel)).toBeGreaterThan(initial)
  const zoomedIn = await canvasScale(panel)

  await page.keyboard.press(`${mod}+-`)
  await expect.poll(() => canvasScale(panel)).toBeLessThan(zoomedIn)
})

// The primary risk this goal names: none of these shortcuts may fire
// while the user is typing in a canvas text field. Focus parked in the
// workflow's own Label input (a real editable target on the canvas,
// not a synthetic one) covers undo, delete, and zoom in one pass.
test('Undo/delete/zoom-in do not fire while focus is in a canvas text input', async ({ page }) => {
  await openNewWorkflow(page)
  const panel = activePanel(page)
  await panel.getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'process-inject-text')
  await expect(panel.locator('.react-flow__node')).toHaveCount(2)
  await panel.getByTestId('toggle-palette').click()
  await clickCanvasNode(page, panel, 'Add text')

  const labelInput = panel.getByLabel('Label')
  const scaleBeforeTyping = await canvasScale(panel)

  // Undo must not fire: the node count stays put. (The field's own text
  // is deliberately not asserted here -- a real browser's native
  // input-level undo may itself react to ⌘Z, which is a separate
  // concern from whether OUR canvas.undo fired.)
  await labelInput.click()
  await labelInput.fill('typing test')
  await page.keyboard.press(`${mod}+z`)
  await expect(panel.locator('.react-flow__node')).toHaveCount(2)

  // Delete/Backspace must edit the field, never remove the selected node.
  await labelInput.fill('typing test')
  await page.keyboard.press('Backspace')
  await expect(labelInput).toHaveValue('typing tes')
  await expect(panel.locator('.react-flow__node')).toHaveCount(2)

  // Zoom-in must not fire: the viewport scale is unchanged.
  await page.keyboard.press(`${mod}+=`)
  expect(await canvasScale(panel)).toBe(scaleBeforeTyping)
})

// One source (shared/canvasCommands.ts): every canvas command the
// toolbar already exposes is also a palette entry, reachable by its
// exact label -- same precedent command-palette.spec.ts's own "every
// new Atlas command is reachable from the palette" test already
// establishes for shared/atlasBoardCommands.ts.
test('Undo/redo/delete/zoom-in/zoom-out/fit view all appear in the command palette', async ({ page }) => {
  await openNewWorkflow(page)
  const paletteDialog = page.getByRole('dialog', { name: 'Command palette' })

  const labels = ['Undo', 'Redo', 'Delete selected', 'Zoom in', 'Zoom out', 'Fit view']
  for (const label of labels) {
    await page.keyboard.press(`${mod}+k`)
    await expect(paletteDialog).toBeVisible()
    await paletteDialog.getByRole('combobox').fill(label)
    await expect(paletteDialog.getByRole('option', { name: label })).toBeVisible()
    await page.keyboard.press('Escape')
  }
})
