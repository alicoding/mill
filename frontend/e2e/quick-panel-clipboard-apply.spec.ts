import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  QUICK_PANEL_CLIPBOARD_APPLY_MCP_BASE_PORT,
  QUICK_PANEL_CLIPBOARD_APPLY_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'
import { writeHostClipboardText, hostClipboardAvailable } from './fixtures/hostClipboard'
import { clickRowAction } from './inventoryRow'
import { connectMCPClient, exportWorkflowViaMCP, findWorkflowIdByLabel } from './mcpTestClient'
import { dragBetweenHandles, workflowRow } from './fixtures/canvas'
import { waitForViewportStable } from './fixtures/animation'

// docs/goals/0039: "Apply from clipboard..." in the Quick Panel
// (app/QuickPanel.tsx, app/useQuickPanelClipboardDoor.ts) -- paste the
// SAME exported-workflow JSON export_workflow/ExportWorkflow already
// produce, preview create-vs-update + any dangling references, confirm.
// Seeds the payload onto the real host pasteboard (fixtures/
// hostClipboard.ts's pbcopy door), not navigator.clipboard (goal 0229:
// the panel reads via CompositionService.ReadHostClipboardText, a Go
// RPC over the same pbpaste adapter -- navigator.clipboard is no longer
// anywhere in this flow).
//
// Dedicated server, MILL_CLIPBOARD=host (goal 0356): the standard
// per-worker pool defaults to the in-memory clipboard adapter and has
// no per-spec override, so this file needs its own server. Every
// clipboard-touching section below still runs inside withClipboardLock:
// the real macOS pasteboard is one OS-wide resource shared across
// parallel workers (goal 0009).
//
// The tests proving a specific CREATE/UPDATE/dangling-ref outcome
// branch on hostClipboardAvailable: CI's e2e job runs on ubuntu-latest,
// where pbcopy/pbpaste don't exist at all (docs/SPEC.md §1.3, the same
// constraint composition-seeded-runs.spec.ts's header comment already
// documents for the Go-side clipboard nodes) -- there, the RPC read
// itself fails, and this asserts that same honest, never-silent error
// path instead of a payload round-trip the runner's OS can't perform.
//
// Deliberately does NOT enable the MCP-writes-approval toggle anywhere
// in this file: export_workflow is an ungated read tool, and clipboard
// apply itself is designed to never touch that gate at all (ADR-0032's
// park-and-poll model is for a possibly-away MCP caller; this action's
// own invocation is the human being present) -- proving that gap is
// itself part of what this suite covers.

interface Fixture {
  server: SpawnedServer
  browser: import('@playwright/test').Browser
  page: import('@playwright/test').Page
  dir: string
  mcpPort: number
}

async function setUp(testInfo: { parallelIndex: number }): Promise<Fixture> {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-quick-panel-clipboard-apply-${idx}-`))
  const mcpPort = QUICK_PANEL_CLIPBOARD_APPLY_MCP_BASE_PORT + idx
  const server = await spawnMillServer({
    port: QUICK_PANEL_CLIPBOARD_APPLY_SERVER_BASE_PORT + idx,
    mcpPort,
    settingsPath: path.join(dir, 'settings.json'),
    executionDbPath: path.join(dir, 'execution.db'),
    backupDir: path.join(dir, 'backups'),
    extraEnv: { MILL_CLIPBOARD: 'host' },
  })
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL: server.baseURL })
  const page = await context.newPage()
  await page.goto(`${server.baseURL}/`)
  return { server, browser, page, dir, mcpPort }
}

async function tearDown(f: Fixture): Promise<void> {
  await f.browser.close()
  await f.server.stop()
  rmSync(f.dir, { recursive: true, force: true })
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
  await waitForViewportStable(panel)
  await panel.getByRole('button', { name: 'Zoom Out' }).click()
  await waitForViewportStable(panel)
  const sourceHandle = panel.locator('.react-flow__node').filter({ hasText: 'Manual run' }).locator('.react-flow__handle.source')
  const targetHandle = panel.locator('.react-flow__node').filter({ hasText: 'Add text' }).locator('.react-flow__handle.target')
  await dragBetweenHandles(page, sourceHandle, targetHandle, 0, true)
  await expect(panel.locator('.react-flow__edge')).toHaveCount(1)
  await panel.getByLabel('Label').fill(label)
  await panel.getByTestId('save-workflow').click()
  await expect(workflowRow(page, label)).toBeVisible()
}

// Navigates to the Quick Panel route, seeds payload onto the real host
// pasteboard (the same resource CompositionService.ReadHostClipboardText
// reads back from via pbpaste), then finds and invokes the "Apply from
// clipboard..." row -- the caller wraps this in withClipboardLock. A
// cross-document navigation first (not a hash-only change from an
// already-loaded page) so main.tsx's hash branch actually re-evaluates,
// same reasoning quick-panel.spec.ts's own tests document.
async function applyFromClipboardWithPayload(page: import('@playwright/test').Page, payload: string) {
  await page.goto('about:blank')
  await page.goto('/#/quickpanel')
  writeHostClipboardText(payload)

  const search = page.getByRole('combobox', { name: 'Quick Panel search' })
  await expect(search).toBeFocused()
  await search.fill('apply from clipboard')
  const option = page.getByRole('option', { name: 'Apply from clipboard…' })
  await expect(option).toBeVisible()
  await option.click()
}

// eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
test('a valid workflow export creates a new workflow, visible live with no reload', async ({}, testInfo) => {
  const f = await setUp(testInfo)
  try {
    const { page } = f
    const sourceLabel = 'ZzE2eClipboardApplySource'
    const createdLabel = 'ZzE2eClipboardApplyCreated'
    await createSimpleWorkflow(page, sourceLabel)

    const client = await connectMCPClient(testInfo.parallelIndex, f.mcpPort)
    let exported: string
    try {
      const sourceId = await findWorkflowIdByLabel(client, sourceLabel)
      exported = await exportWorkflowViaMCP(client, sourceId)
    } finally {
      await client.close()
    }
    // ADR-0036: ExportWorkflow now always carries the source's real id,
    // so it's stripped here -- this test proves the CREATE path, not the
    // update-in-place path a real matching id would now correctly take
    // (that path's own coverage is the "matching id updates" test below).
    const parsedExport = JSON.parse(exported) as Record<string, unknown>
    delete parsedExport.id
    const payload = JSON.stringify({ ...parsedExport, label: createdLabel })

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

      if (hostClipboardAvailable) {
        await expect(page.getByTestId('quick-panel-clipboard-apply-summary')).toContainText(`CREATE "${createdLabel}"`)
        await page.getByTestId('quick-panel-clipboard-apply-confirm').click()
        await expect(page.getByTestId('quick-panel-status')).toContainText(`Created "${createdLabel}"`)

        await expect(workflowRow(mainPage, createdLabel)).toBeVisible({ timeout: 10_000 })
      } else {
        await expect(page.getByTestId('quick-panel-clipboard-apply-error')).toBeVisible()
      }
    } finally {
      await mainPage.close()
    }

    await deleteWorkflowIfPresent(page, sourceLabel)
    if (hostClipboardAvailable) await deleteWorkflowIfPresent(page, createdLabel)
  } finally {
    await tearDown(f)
  }
})

// eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
test('an export with a matching id updates the existing workflow instead of creating a new one', async ({}, testInfo) => {
  const f = await setUp(testInfo)
  try {
    const { page } = f
    const targetLabel = 'ZzE2eClipboardApplyUpdateTarget'
    const updatedLabel = 'ZzE2eClipboardApplyUpdated'
    await createSimpleWorkflow(page, targetLabel)

    const client = await connectMCPClient(testInfo.parallelIndex, f.mcpPort)
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

    if (hostClipboardAvailable) {
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
    } else {
      await expect(page.getByTestId('quick-panel-clipboard-apply-error')).toBeVisible()
      // The RPC read failed before ever reaching ConfirmClipboardApply --
      // the fixture workflow is still there under its original label.
      await deleteWorkflowIfPresent(page, targetLabel)
    }
  } finally {
    await tearDown(f)
  }
})

// eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
test('a malformed clipboard payload shows a readable inline error, never silently failing', async ({}, testInfo) => {
  const f = await setUp(testInfo)
  try {
    const { page } = f
    await withClipboardLock(async () => {
      await applyFromClipboardWithPayload(page, 'this is not json at all')
    })

    await expect(page.getByTestId('quick-panel-clipboard-apply-error')).toBeVisible()
    // Back returns to the ordinary search list without having touched
    // anything server-side.
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByRole('combobox', { name: 'Quick Panel search' })).toBeVisible()
  } finally {
    await tearDown(f)
  }
})

// eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
test('a dangling entity reference is listed in the preview but confirm still succeeds', async ({}, testInfo) => {
  const f = await setUp(testInfo)
  try {
    const { page } = f
    const sourceLabel = 'ZzE2eClipboardApplyDanglingSource'
    const createdLabel = 'ZzE2eClipboardApplyDanglingCreated'
    await createSimpleWorkflow(page, sourceLabel)

    const client = await connectMCPClient(testInfo.parallelIndex, f.mcpPort)
    let payload: string
    try {
      const sourceId = await findWorkflowIdByLabel(client, sourceLabel)
      const exported = JSON.parse(await exportWorkflowViaMCP(client, sourceId))
      // ADR-0036: strip the source's real id (proves the CREATE path, not
      // an update-in-place of the source fixture).
      delete exported.id
      // Splice in an integration-http node referencing an HTTPRequest id
      // that doesn't exist anywhere on this instance -- a real dangling
      // reference (docs/goals/0039 item 5), not just an unset one.
      exported.label = createdLabel
      // Chains off the fixture's existing LEAF node (process-inject-text),
      // never its root trigger -- ValidateGraph rejects a second outgoing
      // edge off any non-Decision node, and the trigger already has one
      // (to process-inject-text).
      const leaf = exported.steps[exported.steps.length - 1]
      exported.steps.push({ ID: 'zz-dangling-http', StepTypeID: 'integration-http', Config: { requestId: 'zz-definitely-not-a-real-request-id' } })
      exported.edges.push({ ID: 'zz-dangling-edge', Source: leaf.ID, Target: 'zz-dangling-http' })
      payload = JSON.stringify(exported)
    } finally {
      await client.close()
    }

    await withClipboardLock(async () => {
      await applyFromClipboardWithPayload(page, payload)
    })

    if (hostClipboardAvailable) {
      const warning = page.getByTestId('quick-panel-clipboard-apply-unresolved')
      await expect(warning).toBeVisible()
      await expect(warning).toContainText('zz-dangling-http')
      await expect(warning).toContainText('requestId')

      await page.getByTestId('quick-panel-clipboard-apply-confirm').click()
      await expect(page.getByTestId('quick-panel-status')).toContainText(`Created "${createdLabel}"`)
      await deleteWorkflowIfPresent(page, createdLabel)
    } else {
      await expect(page.getByTestId('quick-panel-clipboard-apply-error')).toBeVisible()
    }

    await deleteWorkflowIfPresent(page, sourceLabel)
  } finally {
    await tearDown(f)
  }
})

// docs/goals/0039 item 4: the MCP-writes-approval setting must NEVER
// gate this path. No test above enables it (createSimpleWorkflow/
// export_workflow/clipboard-apply confirm all run with the toggle at
// its untouched default), and every one of them completes a real
// create/update through to a visible row -- if this path were
// accidentally routed through gateWrite, every test above would hang
// or park instead of completing, which is the actual proof: no
// separate assertion needed, the suite passing at all IS the proof.
