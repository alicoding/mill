import { test, expect } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'
import { clickRowAction } from './inventoryRow'
import { connectMCPClient, exportWorkflowViaMCP, findWorkflowIdByLabel } from './mcpTestClient'

// docs/goals/0039: "Apply from clipboard..." in the Quick Panel
// (app/QuickPanel.tsx, app/QuickPanelClipboardApply.tsx) -- paste the
// SAME exported-workflow JSON export_workflow/ExportWorkflow already
// produce, preview create-vs-update + any dangling references, confirm.
// Real browser clipboard I/O (Playwright's clipboard-read/clipboard-write
// permissions + navigator.clipboard in the page) -- per
// .claude/rules/testing.md's real-pasteboard discipline, every
// clipboard-touching section below runs inside withClipboardLock even
// though this is the browser's own clipboard API rather than the Go
// osascript/pbcopy adapter (goal 0009's cross-worker OS-pasteboard
// contention risk applies the same way once permissions are granted).
//
// Deliberately does NOT enable the MCP-writes-approval toggle anywhere
// in this file: export_workflow is an ungated read tool, and clipboard
// apply itself is designed to never touch that gate at all (ADR-0032's
// park-and-poll model is for a possibly-away MCP caller; this action's
// own invocation is the human being present) -- proving that gap is
// itself part of what this suite covers.

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

async function deleteWorkflowIfPresent(page: import('@playwright/test').Page, label: string) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  let remaining = await workflowRow(page, label).count()
  while (remaining > 0) {
    await clickRowAction(page, workflowRow(page, label).first(), 'Delete')
    remaining -= 1
    await expect(workflowRow(page, label)).toHaveCount(remaining)
  }
}

// Every fixture workflow here is created through the canvas UI, then
// exported via the real (ungated, read-only) export_workflow MCP tool
// -- matches quick-panel.spec.ts's own createSimpleWorkflow precedent.
// A canvas-driven fixture rather than import_workflow deliberately: MCP
// writes need the MCP-writes-approval toggle enabled first, and this
// suite is specifically proving clipboard apply works WITHOUT ever
// touching that toggle (see the file header + the closing note below).
async function createSimpleWorkflow(page: import('@playwright/test').Page, label: string) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  const panel = page.locator('[role="tabpanel"]:not([hidden])').last()
  await panel.getByTestId('toggle-palette').click()
  await page.evaluate(() => {
    const active = document.querySelector('[role="tabpanel"]:not([hidden])')
    if (!active) throw new Error('no active tabpanel')
    const paletteItem = active.querySelector('[data-node-type-id="process-inject-text"]')
    const canvas = active.querySelector('.react-flow__pane')
    if (!paletteItem || !canvas) throw new Error('drag setup failed')
    const dataTransfer = new DataTransfer()
    const rect = canvas.getBoundingClientRect()
    const clientX = rect.x + rect.width / 2
    const clientY = rect.y + rect.height / 2
    paletteItem.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }))
  })
  await expect(panel.locator('.react-flow__node')).toHaveCount(2)
  await panel.getByRole('button', { name: 'Fit View' }).click()
  await page.waitForTimeout(300)
  await panel.getByRole('button', { name: 'Zoom Out' }).click()
  await page.waitForTimeout(200)
  const sourceHandle = panel.locator('.react-flow__node').filter({ hasText: 'Trigger: manual' }).locator('.react-flow__handle.source')
  const targetHandle = panel.locator('.react-flow__node').filter({ hasText: 'Process: Inject text' }).locator('.react-flow__handle.target')
  await sourceHandle.hover()
  await page.mouse.down()
  await targetHandle.hover()
  await page.mouse.up()
  await expect(panel.locator('.react-flow__edge')).toHaveCount(1)
  await panel.getByLabel('Label').fill(label)
  await panel.getByTestId('save-workflow').click()
  await expect(workflowRow(page, label)).toBeVisible()
}

// Navigates to the Quick Panel route, grants clipboard permissions,
// writes payload into the browser's own clipboard (the same API
// QuickPanelClipboardApply's navigator.clipboard.readText() call reads
// back from), then finds and invokes the "Apply from clipboard..." row
// -- the caller wraps this in withClipboardLock. A cross-document
// navigation first (not a hash-only change from an already-loaded page)
// so main.tsx's hash branch actually re-evaluates, same reasoning
// quick-panel.spec.ts's own tests document.
async function applyFromClipboardWithPayload(page: import('@playwright/test').Page, payload: string) {
  await page.goto('about:blank')
  await page.goto('/#/quickpanel')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate((t) => navigator.clipboard.writeText(t), payload)

  const search = page.getByRole('combobox', { name: 'Quick Panel search' })
  await expect(search).toBeFocused()
  await search.fill('apply from clipboard')
  const option = page.getByRole('option', { name: 'Apply from clipboard…' })
  await expect(option).toBeVisible()
  await option.click()
}

test('a valid workflow export creates a new workflow, visible live with no reload', async ({ page }, testInfo) => {
  const sourceLabel = 'ZzE2eClipboardApplySource'
  const createdLabel = 'ZzE2eClipboardApplyCreated'
  await createSimpleWorkflow(page, sourceLabel)

  const client = await connectMCPClient(testInfo.parallelIndex)
  let exported: string
  try {
    const sourceId = await findWorkflowIdByLabel(client, sourceLabel)
    exported = await exportWorkflowViaMCP(client, sourceId)
  } finally {
    await client.close()
  }
  const payload = JSON.stringify({ ...JSON.parse(exported), label: createdLabel })

  // A second, already-open surface on the Workflows list -- proves the
  // new row appears LIVE (goal 0017's mill-data-changed infra), not
  // just after a subsequent navigation/reload.
  const mainPage = await page.context().newPage()
  try {
    await mainPage.goto('/')
    await mainPage.getByRole('link', { name: 'Workflows' }).click()

    await withClipboardLock(async () => {
      await applyFromClipboardWithPayload(page, payload)
    })

    await expect(page.getByTestId('quick-panel-clipboard-apply-summary')).toContainText(`CREATE "${createdLabel}"`)
    await page.getByTestId('quick-panel-clipboard-apply-confirm').click()
    await expect(page.getByTestId('quick-panel-status')).toContainText(`Created "${createdLabel}"`)

    await expect(workflowRow(mainPage, createdLabel)).toBeVisible({ timeout: 10_000 })
  } finally {
    await mainPage.close()
  }

  await deleteWorkflowIfPresent(page, sourceLabel)
  await deleteWorkflowIfPresent(page, createdLabel)
})

test('an export with a matching id updates the existing workflow instead of creating a new one', async ({ page }, testInfo) => {
  const targetLabel = 'ZzE2eClipboardApplyUpdateTarget'
  const updatedLabel = 'ZzE2eClipboardApplyUpdated'
  await createSimpleWorkflow(page, targetLabel)

  const client = await connectMCPClient(testInfo.parallelIndex)
  let payload: string
  let targetId: string
  try {
    targetId = await findWorkflowIdByLabel(client, targetLabel)
    const exported = await exportWorkflowViaMCP(client, targetId)
    payload = JSON.stringify({ ...JSON.parse(exported), id: targetId, label: updatedLabel })
  } finally {
    await client.close()
  }

  await withClipboardLock(async () => {
    await applyFromClipboardWithPayload(page, payload)
  })

  await expect(page.getByTestId('quick-panel-clipboard-apply-summary')).toContainText(`UPDATE "${updatedLabel}"`)
  await page.getByTestId('quick-panel-clipboard-apply-confirm').click()
  await expect(page.getByTestId('quick-panel-status')).toContainText(`Updated "${updatedLabel}"`)

  // The update replaced the SAME workflow -- the old label is gone, the
  // new one appears exactly once, never a second row alongside it.
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await expect(workflowRow(page, updatedLabel)).toBeVisible({ timeout: 10_000 })
  await expect(workflowRow(page, targetLabel)).toHaveCount(0)

  await deleteWorkflowIfPresent(page, updatedLabel)
})

test('a malformed clipboard payload shows a readable inline error, never silently failing', async ({ page }) => {
  await withClipboardLock(async () => {
    await applyFromClipboardWithPayload(page, 'this is not json at all')
  })

  await expect(page.getByTestId('quick-panel-clipboard-apply-error')).toBeVisible()
  // Back returns to the ordinary search list without having touched
  // anything server-side.
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('combobox', { name: 'Quick Panel search' })).toBeVisible()
})

test('a dangling entity reference is listed in the preview but confirm still succeeds', async ({ page }, testInfo) => {
  const sourceLabel = 'ZzE2eClipboardApplyDanglingSource'
  const createdLabel = 'ZzE2eClipboardApplyDanglingCreated'
  await createSimpleWorkflow(page, sourceLabel)

  const client = await connectMCPClient(testInfo.parallelIndex)
  let payload: string
  try {
    const sourceId = await findWorkflowIdByLabel(client, sourceLabel)
    const exported = JSON.parse(await exportWorkflowViaMCP(client, sourceId))
    // Splice in an integration-http node referencing an HTTPRequest id
    // that doesn't exist anywhere on this instance -- a real dangling
    // reference (docs/goals/0039 item 5), not just an unset one.
    exported.label = createdLabel
    // Chains off the fixture's existing LEAF node (process-inject-text),
    // never its root trigger -- ValidateGraph rejects a second outgoing
    // edge off any non-Decision node, and the trigger already has one
    // (to process-inject-text).
    const leaf = exported.nodes[exported.nodes.length - 1]
    exported.nodes.push({ ID: 'zz-dangling-http', NodeTypeID: 'integration-http', Config: { requestId: 'zz-definitely-not-a-real-request-id' } })
    exported.edges.push({ ID: 'zz-dangling-edge', Source: leaf.ID, Target: 'zz-dangling-http' })
    payload = JSON.stringify(exported)
  } finally {
    await client.close()
  }

  await withClipboardLock(async () => {
    await applyFromClipboardWithPayload(page, payload)
  })

  const warning = page.getByTestId('quick-panel-clipboard-apply-unresolved')
  await expect(warning).toBeVisible()
  await expect(warning).toContainText('zz-dangling-http')
  await expect(warning).toContainText('requestId')

  await page.getByTestId('quick-panel-clipboard-apply-confirm').click()
  await expect(page.getByTestId('quick-panel-status')).toContainText(`Created "${createdLabel}"`)

  await deleteWorkflowIfPresent(page, sourceLabel)
  await deleteWorkflowIfPresent(page, createdLabel)
})

// docs/goals/0039 item 4: the MCP-writes-approval setting must NEVER
// gate this path. No test above enables it (createSimpleWorkflow/
// export_workflow/clipboard-apply confirm all run with the toggle at
// its untouched default), and every one of them completes a real
// create/update through to a visible row -- if this path were
// accidentally routed through gateWrite, every test above would hang
// or park instead of completing, which is the actual proof: no
// separate assertion needed, the suite passing at all IS the proof.
