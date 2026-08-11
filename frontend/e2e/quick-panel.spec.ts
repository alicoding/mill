import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'

// Exercises the Quick Panel's frontend (docs/adr/0033-quick-panel-
// second-window.md, app/QuickPanel.tsx) at its hash route
// (/#/quickpanel) over real Go bindings (Wails3 server mode). The
// route itself is fully e2e-able headlessly -- confirmed directly
// against the beta.4 SDK source: server-mode "windows" are
// BrowserWindow connections keyed by whatever page a browser tab
// loads, and this second window's URL is a hash fragment of the SAME
// served index.html main.tsx already renders, so page.goto('/#/quickpanel')
// exercises the real production code path (main.tsx's hash branch),
// not a stand-in. What's NOT headlessly verifiable is the WINDOW-LEVEL
// behavior around it (floating window level, hide-on-blur/Escape via
// the native HideOnFocusLost/HideOnEscape options, the focus-yield
// mitigation, and the real global summon hotkey delivery) -- those are
// registered in the manual-only registry (.claude/skills/run-mill/SKILL.md)
// per .claude/rules/testing.md's own "manual-only registry... never
// silently absent" requirement.

function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

// Same helpers as command-palette.spec.ts's own local copies (see that
// file's comments for the full reasoning on each) -- duplicated rather
// than shared, matching this suite's existing per-spec-file convention.
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

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

// A deliberately clipboard-free workflow (trigger-manual -> a plain
// process-inject-text step, per .claude/rules/testing.md's own
// guidance to prefer a workflow that doesn't touch the clipboard over
// taking the cross-process clipboard lock).
async function createSimpleWorkflow(page: import('@playwright/test').Page, label: string) {
  await page.goto('/')
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

async function deleteWorkflow(page: import('@playwright/test').Page, label: string) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  const row = workflowRow(page, label)
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
}

test('the Quick Panel route renders standalone with an autofocused search input', async ({ page }) => {
  await page.goto('/#/quickpanel')

  const search = page.getByRole('combobox', { name: 'Quick Panel search' })
  await expect(search).toBeVisible()
  await expect(search).toBeFocused()

  // No sidebar/PageLayout chrome -- this is the dedicated minimal
  // shell (QuickPanelApp), not <App/>'s tree.
  await expect(page.getByRole('link', { name: 'Workflows' })).toHaveCount(0)

  await expect(page.getByRole('option', { name: 'Open Mill' })).toBeVisible()
  await expect(page.getByRole('option', { name: /Open Settings/ })).toBeVisible()
})

test('a seeded workflow is listed and Enter runs it, showing a started confirmation', async ({ page }) => {
  const label = 'ZzE2eQuickPanelRunTarget'
  await createSimpleWorkflow(page, label)

  // A hash-only change from the already-loaded '/' is a same-document
  // navigation (no reload), which would leave <App/> mounted instead of
  // re-evaluating main.tsx's hash branch -- forcing a genuine
  // cross-document navigation first (as every real second-window load
  // is) so this exercises the real branch, not a stale DOM.
  await page.goto('about:blank')
  await page.goto('/#/quickpanel')
  const search = page.getByRole('combobox', { name: 'Quick Panel search' })
  await expect(search).toBeFocused()
  await search.fill(label)

  const runOption = page.getByRole('option', { name: label })
  await expect(runOption).toBeVisible()

  await page.keyboard.press('Enter')
  await expect(page.getByTestId('quick-panel-status')).toContainText(`Started "${label}"`)

  await deleteWorkflow(page, label)
})
