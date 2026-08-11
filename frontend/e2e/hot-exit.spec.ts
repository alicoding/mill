import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// Hot exit for the canvas authoring surface (docs/goals/0012-authoring-
// hot-exit.md): unsaved canvas edits must survive a reload -- the
// closest Playwright equivalent to a quit/close/crash for
// localStorage-backed state (same reasoning state-persistence.spec.ts's
// header comment already establishes; a real desktop-app kill -9 isn't
// reachable from server-mode Playwright, but the mechanism under test
// -- localStorage scratch surviving the *page* going away and coming
// back -- is identical either way). Configure forms are deliberately
// out of this goal's own scope ("Canvas only") -- nothing here touches
// them.
//
// Deliberately avoids every clipboard-touching node
// (capture-clipboard-html/apply-clipboard-write-*), so none of these
// tests need withClipboardLock: process-inject-text is a plain Process
// node with a real, typed config field and zero OS-pasteboard
// dependency -- exactly what's needed to prove config-field content
// round-trips through hot-exit scratch, without serializing this whole
// file behind the one real macOS clipboard.

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

// See composition.spec.ts's own copy of this helper for the full
// reasoning (Primer's TabPanel keeps every open tab mounted, toggling
// `hidden` rather than unmounting).
function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

// See composition.spec.ts's own copy of this helper for the full
// reasoning (Locator.dragTo() doesn't fire real HTML5 DnD events, so
// the palette's onDragStart/onDrop handlers need manually-dispatched
// DragEvents instead).
async function dragPaletteItemToCanvas(page: import('@playwright/test').Page, nodeTypeID: string) {
  await page.evaluate((id) => {
    const panel = document.querySelector('[role="tabpanel"]:not([hidden])')
    if (!panel) throw new Error('no active tabpanel')
    const palette = panel.querySelector(`[data-node-type-id="${id}"]`)
    const canvas = panel.querySelector('.react-flow__pane')
    if (!palette || !canvas) {
      throw new Error(`drag setup failed: palette found=${!!palette} canvas found=${!!canvas}`)
    }
    const dataTransfer = new DataTransfer()
    const rect = canvas.getBoundingClientRect()
    const clientX = rect.x + rect.width / 2
    const clientY = rect.y + rect.height / 2
    palette.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }))
  }, nodeTypeID)
}

// See composition-canvas-interactions.spec.ts's own copy of this
// helper for the full reasoning (a real mouse down/move/up sequence
// between two Handles, plus the Fit View + settle-wait so a node's
// handle isn't hidden under the MiniMap/Controls overlay).
async function connectNodes(page: import('@playwright/test').Page, sourceLabel: string, targetLabel: string) {
  const panel = activePanel(page)
  await panel.getByRole('button', { name: 'Fit View' }).click()
  await page.waitForTimeout(300)
  const sourceHandle = panel.locator('.react-flow__node').filter({ hasText: sourceLabel }).locator('.react-flow__handle.source')
  const targetHandle = panel.locator('.react-flow__node').filter({ hasText: targetLabel }).locator('.react-flow__handle.target')
  const sourceBox = await sourceHandle.boundingBox()
  const targetBox = await targetHandle.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('connectNodes: handle bounding box not found')
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 })
  await page.mouse.up()
}

// See composition-canvas-interactions.spec.ts's own copy of this
// helper for the full reasoning (a node's own bounding box can be
// partly covered by real React Flow chrome -- Controls/MiniMap -- so a
// few candidate points are tried and verified via elementFromPoint
// before clicking one for real).
async function clickCanvasNode(page: import('@playwright/test').Page, panel: import('@playwright/test').Locator, label: string) {
  const node = panel.locator('.react-flow__node').filter({ hasText: label })
  const box = await node.boundingBox()
  if (!box) throw new Error(`clickCanvasNode: node "${label}" has no bounding box`)
  const candidates = [
    { x: box.x + 10, y: box.y + 10 },
    { x: box.x + box.width - 10, y: box.y + 10 },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + 10, y: box.y + box.height - 10 },
  ]
  for (const point of candidates) {
    const insideNode = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return !!el?.closest('.react-flow__node')
    }, point)
    if (insideNode) {
      await page.mouse.click(point.x, point.y)
      return
    }
  }
  throw new Error(`clickCanvasNode: no point for node "${label}" resolved inside its own card`)
}

// Polls localStorage for the debounced scratch write (canvasScratch.ts,
// ~500ms) to actually contain `marker`, rather than a flat
// `waitForTimeout` -- the canvas's own authoring-validation surface
// (docs/adr/0028's debounced ValidateDraft, useDraftValidation.ts) can
// attach a fresh warning to a newly-added leaf node ~500ms after this
// test's own edits settle, which changes the canvas store's `nodes`
// reference again and re-arms the scratch-write debounce a second
// time -- a fixed short wait can race that second debounce and reload
// before the write lands. Polling for the actual written content is
// correct regardless of how many times the debounce got re-armed.
async function waitForScratchWrite(page: import('@playwright/test').Page, marker: string) {
  await expect
    .poll(() =>
      page.evaluate((needle) => {
        for (const key of Object.keys(localStorage)) {
          if (!key.startsWith('mill-canvas-scratch:')) continue
          if ((localStorage.getItem(key) ?? '').includes(needle)) return true
        }
        return false
      }, marker),
    )
    .toBe(true)
}

// Shared setup for the new-workflow-tab cases: composes a fresh "New
// workflow" canvas with process-inject-text wired downstream of the
// starter trigger, types a marker string into its text field, sets the
// workflow's Label, and waits for the debounced scratch write to
// actually land so a caller's immediate reload sees it.
async function composeUnsavedInjectTextWorkflow(page: import('@playwright/test').Page, label: string, marker: string) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'process-inject-text')
  await connectNodes(page, 'Trigger: manual', 'Process: Inject text')
  await clickCanvasNode(page, activePanel(page), 'Process: Inject text')
  const textField = activePanel(page).locator('textarea[data-testid="canvas-config-field"]')
  await textField.fill(marker)
  await textField.blur()
  await activePanel(page).getByLabel('Label').fill(label)
  await waitForScratchWrite(page, marker)
}

test('editing an existing saved workflow: unsaved edits survive a reload, with a restored-unsaved indicator', async ({ page }) => {
  // Built-in workflows have no Edit control (SPEC.md §2.2) -- compose
  // and save a real edit target first.
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByLabel('Label').fill('E2E hot-exit edit target')
  await activePanel(page).getByTestId('save-workflow').click()

  const row = workflowRow(page, 'E2E hot-exit edit target')
  await expect(row).toBeVisible()

  // Reopen it and make a real, unsaved edit -- Save always closes the
  // work tab (confirmed by composition.spec.ts's own reused-tab test),
  // so this is a fresh editor tab over the already-saved baseline. Row
  // click opens VIEW mode now (docs/goals/0022); Edit switches this
  // SAME tab into the editor before any editing happens -- hot-exit
  // scratch only ever tracks from that switch forward (view mode
  // itself never checks a scratch at all, see useCanvasHotExit.ts).
  await row.click()
  await activePanel(page).getByTestId('edit-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'process-inject-text')
  await connectNodes(page, 'Trigger: manual', 'Process: Inject text')
  await clickCanvasNode(page, activePanel(page), 'Process: Inject text')
  const textField = activePanel(page).locator('textarea[data-testid="canvas-config-field"]')
  await textField.fill('e2e edit-target marker')
  await textField.blur()
  await waitForScratchWrite(page, 'e2e edit-target marker')

  await page.reload()
  await page.getByRole('link', { name: 'Workflows' }).click()
  // Restored into the app-wide strip present but not auto-activated
  // (SPEC.md §3.7's restore-inactive rule) -- click it to land inside.
  await page.getByRole('tab', { name: 'E2E hot-exit edit target' }).click()

  await expect(page.getByTestId('restored-unsaved')).toBeVisible()
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)
  // A fresh page load hasn't settled React Flow's own Fit View/Controls
  // layout the way connectNodes' own Fit View click already did before
  // reload -- re-stabilize it before clicking a node card (same
  // reasoning as connectNodes' own doc comment).
  await activePanel(page).getByRole('button', { name: 'Fit View' }).click()
  await page.waitForTimeout(300)
  await clickCanvasNode(page, activePanel(page), 'Process: Inject text')
  await expect(activePanel(page).locator('textarea[data-testid="canvas-config-field"]')).toHaveValue('e2e edit-target marker')

  // Deliberate close discards the scratch; the underlying saved
  // workflow (created by this test) still needs deleting.
  await page.getByRole('button', { name: 'Close tab' }).last().click()
  await clickRowAction(page, workflowRow(page, 'E2E hot-exit edit target'), 'Delete')
})

test('saving discards the hot-exit scratch entry -- no restored-unsaved indicator after a reload', async ({ page }) => {
  await composeUnsavedInjectTextWorkflow(page, 'E2E hot-exit saved', 'e2e hot-exit saved marker')

  // Confirm the scratch entry actually exists pre-Save -- otherwise
  // this test would trivially pass with zero real coverage of the
  // "clear on Save" requirement.
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('mill-canvas-scratch:'))))
    .toBe(true)

  await activePanel(page).getByTestId('save-workflow').click()
  const row = workflowRow(page, 'E2E hot-exit saved')
  await expect(row).toBeVisible()

  await expect(page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('mill-canvas-scratch:')))).resolves.toBe(false)

  // A reload afterward confirms the save-closed tab doesn't resurrect
  // any restored-unsaved state either -- the acceptance criterion's own
  // "Save → reload → no indicator" framing.
  await page.reload()
  await page.getByRole('link', { name: 'Workflows' }).click()
  await expect(page.getByTestId('restored-unsaved')).toHaveCount(0)
  await expect(page.getByTestId('dirty-indicator')).toHaveCount(0)

  await clickRowAction(page, workflowRow(page, 'E2E hot-exit saved'), 'Delete')
})

test('deliberately closing a tab discards its scratch', async ({ page }) => {
  await composeUnsavedInjectTextWorkflow(page, 'E2E hot-exit discarded', 'e2e hot-exit discard marker')

  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mill-canvas-scratch:')).length))
    .toBe(1)

  await page.getByRole('button', { name: 'Close tab' }).last().click()

  await expect(
    page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mill-canvas-scratch:')).length),
  ).resolves.toBe(0)

  // A fresh New workflow tab afterward shows a genuinely clean canvas
  // -- confirming there's nothing left to (incorrectly) restore, not
  // just that the storage key count happens to read zero.
  await page.getByTestId('new-workflow').click()
  await expect(page.getByTestId('restored-unsaved')).toHaveCount(0)
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(1)
  await expect(activePanel(page).getByLabel('Label')).toHaveValue('')

  await page.getByRole('button', { name: 'Close tab' }).last().click()
})

test('a new-workflow tab (never saved) also survives a reload, edits intact', async ({ page }) => {
  await composeUnsavedInjectTextWorkflow(page, 'E2E hot-exit new-workflow', 'e2e new-workflow marker')

  await page.reload()
  await page.getByRole('link', { name: 'Workflows' }).click()

  // The tab itself surviving the reload at all is the new part here --
  // 'workflow-new' tabs weren't restorable before this goal (only
  // 'workflow-edit'/'request-view' were, shared/store.ts's isRestorable).
  const tab = page.getByRole('tab', { name: 'New workflow' })
  await expect(tab).toBeVisible()
  await tab.click()

  await expect(page.getByTestId('restored-unsaved')).toBeVisible()
  await expect(activePanel(page).getByLabel('Label')).toHaveValue('E2E hot-exit new-workflow')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)
  // Re-stabilize React Flow's Fit View/Controls layout after the fresh
  // page load, same reasoning as the edit-target test above.
  await activePanel(page).getByRole('button', { name: 'Fit View' }).click()
  await page.waitForTimeout(300)
  await clickCanvasNode(page, activePanel(page), 'Process: Inject text')
  await expect(activePanel(page).locator('textarea[data-testid="canvas-config-field"]')).toHaveValue('e2e new-workflow marker')

  // Never saved -- no server-side entity to clean up, just the tab.
  await page.getByRole('button', { name: 'Close tab' }).last().click()
})
