import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import { connectMCPClient, findWorkflowIdByLabel } from './mcpTestClient'
import { assignDebugWorkflowHotkey } from './hotkeyDebugKnob'

// Exercises the ⌘K command palette (docs/goals/0015-summon-quick-invoke.md,
// app/CommandPalette.tsx) over real Go bindings (Wails3 server mode),
// same setup/limitations as every other spec in this suite: OS-level
// global-hotkey delivery isn't exercisable headlessly (docs/SPEC.md
// §1.3), but the palette's own binding is a plain in-window `keydown`
// listener (shared/commands.ts's dispatchCommandForEvent, App.tsx's one
// window listener), same shape Meta+S/Meta+N already get real coverage
// through in keymap.spec.ts -- so Meta+k here is real, not a stand-in.

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

function paletteDialog(page: import('@playwright/test').Page) {
  return page.getByRole('dialog', { name: 'Command palette' })
}

// See live-run-state.spec.ts's own copy of these two helpers for the
// full reasoning (Fit View + a Zoom Out first avoids the toolbar/
// MiniMap overlap hazard a 2-node graph's default layout can hit;
// `.hover()` re-resolves the handle's live position immediately before
// the mouse event, where an earlier-captured bounding box can drift off
// a 12x12 handle).
async function fitAndSpaceOut(page: import('@playwright/test').Page) {
  const panel = activePanel(page)
  await panel.getByRole('button', { name: 'Fit View' }).click()
  await page.waitForTimeout(300)
  await panel.getByRole('button', { name: 'Zoom Out' }).click()
  await page.waitForTimeout(200)
}

async function connectNodes(page: import('@playwright/test').Page, sourceLabel: string, targetLabel: string) {
  const panel = activePanel(page)
  const sourceHandle = panel.locator('.react-flow__node').filter({ hasText: sourceLabel }).locator('.react-flow__handle.source')
  const targetHandle = panel.locator('.react-flow__node').filter({ hasText: targetLabel }).locator('.react-flow__handle.target')
  await sourceHandle.hover()
  await page.mouse.down()
  await targetHandle.hover()
  await page.mouse.up()
}

// Same drag mechanism every canvas spec uses (Locator.dragTo() doesn't
// fire real HTML5 DnD events -- see composition.spec.ts's own copy of
// this helper for the full reasoning).
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

// A deliberately clipboard-free workflow (trigger-manual -> a plain
// process-inject-text step, per .claude/rules/testing.md's own guidance
// to prefer a workflow that doesn't touch the clipboard over taking the
// cross-process clipboard lock) -- the exact recipe
// live-run-state.spec.ts already proved runs end-to-end. Save closes
// the editor tab automatically (composition/CompositionCanvas.tsx's
// onSaved), leaving the new row in the Workflows list, which is what
// this spec's palette tests actually want to search for.
async function createSimpleWorkflow(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'process-inject-text')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)
  await fitAndSpaceOut(page)
  await connectNodes(page, 'Trigger: manual', 'Process: Inject text')
  await expect(activePanel(page).locator('.react-flow__edge')).toHaveCount(1)
  await activePanel(page).getByLabel('Label').fill(label)
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(workflowRow(page, label)).toBeVisible()
}

// A single trigger-hotkey root node, no second step -- matches
// trigger-row.spec.ts's own hotkey-row test recipe (a bare Trigger node
// is a valid, saveable graph; nothing here needs to actually run).
async function createHotkeyTriggerWorkflow(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).locator('.react-flow__node').first().click()
  await activePanel(page).getByTestId('change-node-type').selectOption('trigger-hotkey')
  await activePanel(page).getByLabel('Label').fill(label)
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(workflowRow(page, label)).toBeVisible()
}

// Design-wave-1 fix #2: rest-state bound + fixed max-height/internal
// scroll, Spotlight/Raycast/VS Code convention (the palette used to
// render every command+workflow+tab unfiltered and grow the Dialog to
// fit however many results that was).
test('Meta+K rest-state shows a bounded set (nav commands only) until a query narrows it', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Meta+k')
  await expect(paletteDialog(page)).toBeVisible()

  // Nav ("Go to <X>" + Settings) commands are present at rest.
  await expect(paletteDialog(page).getByRole('option', { name: /Go to Workflows/ })).toBeVisible()
  await expect(paletteDialog(page).getByRole('option', { name: 'Open Settings' })).toBeVisible()

  // A non-nav command ("Next tab") stays out of the rest-state list --
  // it only appears once the user actually searches for it, same as
  // the existing "typing filters to a command" test above proves for
  // the query-driven path.
  await expect(paletteDialog(page).getByRole('option', { name: /Next tab/ })).toHaveCount(0)

  await page.keyboard.press('Escape')
})

test('the palette list is height-bounded with internal scroll, not the Dialog growing unbounded', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Meta+k')
  await expect(paletteDialog(page)).toBeVisible()

  const list = paletteDialog(page).locator('[data-testid="filtered-action-list"]')
  await expect(list).toBeVisible()
  const maxHeight = await list.evaluate((el) => getComputedStyle(el).maxHeight)
  expect(maxHeight).not.toBe('none')

  await page.keyboard.press('Escape')
})

test('Meta+K opens the palette; typing filters to a command and shows its effective shortcut', async ({ page }) => {
  await page.goto('/')

  await expect(paletteDialog(page)).toHaveCount(0)
  await page.keyboard.press('Meta+k')
  await expect(paletteDialog(page)).toBeVisible()

  // "Next tab" (tab.next) defaults to Ctrl+Tab (docs/SPEC.md §3.7's
  // keymap entry) -- formatCombo renders it as the glyph string "⌃TAB",
  // the same function Settings' own Keyboard Shortcuts section uses, so
  // this is asserting the SAME effective-binding text a rebind would
  // change, not a hardcoded copy of it.
  // Primer's FilteredActionListInput renders the search box as
  // role="combobox" (an ARIA 1.2 combobox-driving-a-listbox pattern),
  // not a plain textbox -- confirmed against a real accessibility
  // snapshot, not assumed.
  await paletteDialog(page).getByRole('combobox').fill('tab')
  const nextTabOption = paletteDialog(page).getByRole('option', { name: /Next tab/ })
  await expect(nextTabOption).toBeVisible()
  await expect(nextTabOption).toContainText('⌃TAB')

  // A command not matching "tab" at all is filtered out.
  await expect(paletteDialog(page).getByText('Open Settings', { exact: true })).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(paletteDialog(page)).toHaveCount(0)
})

test('Enter on a workflow"s Run row test-runs it, closes the palette, and the run surfaces in Activity', async ({ page }) => {
  const label = 'ZzE2ePaletteRunTarget'
  await page.goto('/')
  await createSimpleWorkflow(page, label)

  await page.keyboard.press('Meta+k')
  await expect(paletteDialog(page)).toBeVisible()
  await paletteDialog(page).getByRole('combobox').fill(label)

  const runOption = paletteDialog(page).getByRole('option', { name: new RegExp(`Run: ${label}`) })
  await expect(runOption).toBeVisible()

  // The Run row is the top (and, for this deliberately unique label,
  // only-matching-first) entry in the Workflows group, so a plain Enter
  // activates it -- the same "type a few letters, hit Enter, it runs"
  // shape the goal's own acceptance criterion describes.
  await page.keyboard.press('Enter')
  await expect(paletteDialog(page)).toHaveCount(0)

  await page.getByRole('link', { name: 'Activity' }).click()
  const activityRow = page.locator('table tbody tr').filter({ hasText: 'Manual run' }).filter({ hasText: label })
  await expect(activityRow).toBeVisible()

  // Cleanup (.claude/rules/testing.md: delete what you create -- other
  // tests in this file share this worker's server/data).
  await page.getByRole('link', { name: 'Workflows' }).click()
  const row = workflowRow(page, label)
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
})

// docs/goals/0015-summon-quick-invoke.md's last open item: a workflow
// row's own Hotkey-trigger combo, not just an app-level command's
// shortcut (already covered by hotkey-hint.spec.ts). Real hotkey
// assignment can't run headlessly (see hotkeyDebugKnob.ts's own header
// comment) -- assignDebugWorkflowHotkey records the combo server-side
// the same way a real AssignHotkey call would, minus the OS probe.
test('a workflow row shows its own hotkey-trigger combo inline; a non-hotkey trigger shows none', async ({ page }, testInfo) => {
  const hotkeyLabel = 'ZzE2ePaletteHotkeyChipX'
  const manualLabel = 'ZzE2ePaletteNoHotkeyChip'
  await page.goto('/')
  await createHotkeyTriggerWorkflow(page, hotkeyLabel)
  await createSimpleWorkflow(page, manualLabel)

  const client = await connectMCPClient(testInfo.parallelIndex)
  let hotkeyWorkflowId: string
  try {
    hotkeyWorkflowId = await findWorkflowIdByLabel(client, hotkeyLabel)
  } finally {
    await client.close()
  }
  await assignDebugWorkflowHotkey(page, hotkeyWorkflowId, ['CMD', 'SHIFT'], 'M')

  await page.keyboard.press('Meta+k')
  await expect(paletteDialog(page)).toBeVisible()

  await paletteDialog(page).getByRole('combobox').fill(hotkeyLabel)
  const hotkeyOption = paletteDialog(page).getByRole('option', { name: new RegExp(`Run: ${hotkeyLabel}`) })
  await expect(hotkeyOption).toBeVisible()
  await expect(hotkeyOption.getByTestId('workflow-hotkey-chip')).toHaveText('⌘⇧M')

  // A manual-trigger row's Run entry carries no hotkey-chip testid at
  // all -- not just an empty one -- since WorkflowRowTrailingVisual only
  // renders KeyComboChip when a combo is actually present.
  await paletteDialog(page).getByRole('combobox').fill(manualLabel)
  const manualOption = paletteDialog(page).getByRole('option', { name: new RegExp(`Run: ${manualLabel}`) })
  await expect(manualOption).toBeVisible()
  await expect(manualOption.getByTestId('workflow-hotkey-chip')).toHaveCount(0)

  await page.keyboard.press('Escape')

  // Cleanup.
  await page.getByRole('link', { name: 'Workflows' }).click()
  await clickRowAction(page, workflowRow(page, hotkeyLabel), 'Delete')
  await expect(workflowRow(page, hotkeyLabel)).toHaveCount(0)
  await clickRowAction(page, workflowRow(page, manualLabel), 'Delete')
  await expect(workflowRow(page, manualLabel)).toHaveCount(0)
})
