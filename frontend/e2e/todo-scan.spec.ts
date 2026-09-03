import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, expect } from './fixtures/server'
import { callBindingViaRPC } from './fixtures/wailsRpc'

// Shared worker pool: the assertions read only this test's own run and
// its own temp folders. Drives the seeded "Example: TODO scan -> sheet"
// workflow through the same bound RPCs a canvas edit + Run button use
// (testing.md: the real RPC, without the drag/click gesture the
// harness can't produce) -- every edit made to the seeded workflow's
// config is restored in the finally block.
const WORKFLOW_ID = 'example-todo-scan-workflow'
const SCAN_NODE_ID = 'example-todoscan-scan'
const WRITE_NODE_ID = 'example-todoscan-write'

interface CompNode {
  ID: string
  NodeTypeID: string
  Config: Record<string, string>
}
interface CompWorkflow {
  ID: string
  Label: string
  Description: string
  Nodes: CompNode[]
  Edges: unknown[]
}
interface RunSummary {
  runID: string
  status: string
  pending?: { nodeID: string } | null
}
interface RunDetail extends RunSummary {
  steps: unknown[]
}

test('the seeded TODO scan workflow finds real markers and writes the CSV table', async ({ page }) => {
  const scanDir = mkdtempSync(path.join(tmpdir(), 'mill-e2e-todoscan-src-'))
  const outDir = mkdtempSync(path.join(tmpdir(), 'mill-e2e-todoscan-out-'))
  const outPath = path.join(outDir, 'todo-scan.csv')
  writeFileSync(path.join(scanDir, 'a.go'), 'package a\n// TODO: first\n')
  writeFileSync(path.join(scanDir, 'b.md'), 'notes\n# FIXME second\n')

  await page.goto('/')

  const workflows = await callBindingViaRPC<CompWorkflow[]>(
    page,
    'github.com/alicoding/mill/internal/services/compositionsvc.CompositionService.Workflows',
    [],
  )
  const workflow = workflows.find((w) => w.ID === WORKFLOW_ID)
  if (!workflow) throw new Error(`seeded workflow ${WORKFLOW_ID} not found`)
  const originalNodes = JSON.parse(JSON.stringify(workflow.Nodes)) as CompNode[]

  const scanNode = workflow.Nodes.find((n) => n.ID === SCAN_NODE_ID)
  const writeNode = workflow.Nodes.find((n) => n.ID === WRITE_NODE_ID)
  if (!scanNode || !writeNode) throw new Error('seeded todo-scan workflow is missing its scan/write step')
  scanNode.Config = { ...scanNode.Config, path: scanDir }
  writeNode.Config = { ...writeNode.Config, path: outPath }

  try {
    await callBindingViaRPC(
      page,
      'github.com/alicoding/mill/internal/services/compositionsvc.CompositionService.UpdateWorkflow',
      [WORKFLOW_ID, workflow.Label, workflow.Description, workflow.Nodes, workflow.Edges],
    )
    await callBindingViaRPC(
      page,
      'github.com/alicoding/mill/internal/services/compositionsvc.CompositionService.SetWorkflowDisabled',
      [WORKFLOW_ID, false],
    )

    const run = await callBindingViaRPC<RunSummary>(
      page,
      'github.com/alicoding/mill/internal/services/executionsvc.ExecutionService.RunWorkflow',
      [WORKFLOW_ID, 'test', null],
    )
    if (run.status === 'PENDING' && run.pending) {
      await callBindingViaRPC(
        page,
        'github.com/alicoding/mill/internal/services/executionsvc.ExecutionService.ResolveApproval',
        [run.runID, run.pending.nodeID, true, {}, true],
      )
    }

    // RunDetail.status is DBOS's own raw workflow status vocabulary
    // (executionservice_summary.go), not the per-step "succeeded" the
    // same response's Steps array uses.
    await expect
      .poll(async () => {
        const detail = await callBindingViaRPC<RunDetail>(
          page,
          'github.com/alicoding/mill/internal/services/executionsvc.ExecutionService.GetRun',
          [run.runID],
        )
        return detail.status
      })
      .toBe('SUCCESS')

    const csv = readFileSync(outPath, 'utf8')
    expect(csv).toBe('file,line,marker,text\na.go,2,TODO,first\nb.md,2,FIXME,second\n')
  } finally {
    await callBindingViaRPC(
      page,
      'github.com/alicoding/mill/internal/services/compositionsvc.CompositionService.UpdateWorkflow',
      [WORKFLOW_ID, workflow.Label, workflow.Description, originalNodes, workflow.Edges],
    )
    await callBindingViaRPC(
      page,
      'github.com/alicoding/mill/internal/services/compositionsvc.CompositionService.SetWorkflowDisabled',
      [WORKFLOW_ID, true],
    )
    rmSync(scanDir, { recursive: true, force: true })
    rmSync(outDir, { recursive: true, force: true })
  }
})
