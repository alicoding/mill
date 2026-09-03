// The seeded Bruno run (goal 0308): the bru CLI runs as a guarded
// shell step, its JSON report is read back and mirrored into the
// seeded Example: Bruno results List, one row per request. bru itself
// is stubbed on PATH (a script that writes a report shaped like bru's
// --reporter-json) through an execution environment this test creates;
// the seeded workflow's step is pointed at it through the same
// UpdateWorkflow a canvas save makes. Shared pool: the environment and
// the rows are this test's own to clean up.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './fixtures/server'
import { callBindingViaRPC } from './fixtures/wailsRpc'

const CONFIGURE = 'github.com/alicoding/mill/internal/services/configuresvc.ConfigureService'
const COMPOSITION = 'github.com/alicoding/mill/internal/services/compositionsvc.CompositionService'
const EXECUTION = 'github.com/alicoding/mill/internal/services/executionsvc.ExecutionService'
const WORKFLOW_ID = 'example-bruno-run-workflow'
const STEP_ID = 'example-bruno-run-step'
const LIST_ID = 'example-bruno-results-list'

const STUB_BRU = `#!/bin/sh
# A stand-in for the bru CLI: writes a report shaped like --reporter-json to the path it is given.
out=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--reporter-json" ]; then out="$2"; shift; fi
  shift
done
cat > "$out" <<'JSON'
{"summary":{"totalRequests":2,"passedRequests":1,"failedRequests":1},"results":[
{"name":"ping","path":"ping.bru","suitename":"ping","request":{"method":"GET","url":"http://h/ping"},"response":{"status":200,"duration":12},"status":"pass","error":null},
{"name":"create user","path":"users/create.bru","suitename":"users/create","request":{"method":"POST","url":"http://h/users"},"response":{"status":500,"duration":40},"status":"fail","error":"assertion failed"}]}
JSON
exit 1
`

type Node = { ID: string; NodeTypeID: string; Config: Record<string, string> | null; Position: { X: number; Y: number } }
type Workflow = { ID: string; Label: string; Description: string; Nodes: Node[]; Edges: unknown[] }

test('the seeded Bruno run mirrors the CLI report into the results List, one row per request', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-bruno-'))
  fs.writeFileSync(path.join(dir, 'bru'), STUB_BRU, { mode: 0o755 })
  await page.goto('/')
  const env = await callBindingViaRPC<{ ID: string }>(page, `${CONFIGURE}.CreateExecEnv`, ['ZzE2eBrunoStubEnv', 'sh', 'clean', '<mill-temp>', [`PATH=${dir}:/usr/bin:/bin`]])
  try {
    const workflows = await callBindingViaRPC<Workflow[]>(page, `${COMPOSITION}.Workflows`, [])
    const wf = workflows.find((w) => w.ID === WORKFLOW_ID)
    expect(wf, 'the seeded Bruno run workflow exists').toBeTruthy()
    const nodes = wf!.Nodes.map((n) => (n.ID === STEP_ID ? { ...n, Config: { ...(n.Config ?? {}), envId: env.ID } } : n))
    await callBindingViaRPC(page, `${COMPOSITION}.UpdateWorkflow`, [wf!.ID, wf!.Label, wf!.Description, nodes, wf!.Edges])
    await callBindingViaRPC(page, `${COMPOSITION}.PublishWorkflow`, [wf!.ID])

    const run = await callBindingViaRPC<{ runID: string }>(page, `${EXECUTION}.RunWorkflow`, [WORKFLOW_ID, 'test', {}])
    const status = async () => {
      const detail = await callBindingViaRPC<{ status?: string; Status?: string }>(page, `${EXECUTION}.GetRun`, [run.runID])
      return (detail.status ?? detail.Status ?? '').toUpperCase()
    }
    // Running a command is an external effect: the run parks for approval.
    await expect.poll(status, { timeout: 30_000 }).toMatch(/PENDING|SUCCESS|SUCCEEDED|DONE/)
    if ((await status()).includes('PENDING')) {
      await callBindingViaRPC(page, `${EXECUTION}.ResolveApproval`, [run.runID, STEP_ID, true, {}, true])
    }
    await expect.poll(status, { timeout: 60_000 }).toMatch(/SUCCESS|SUCCEEDED|DONE/)

    const list = await callBindingViaRPC<{ Rows: { Values: Record<string, string>; Status: string }[] | null }>(page, `${CONFIGURE}.GetList`, [LIST_ID])
    const rows = (list.Rows ?? []).filter((r) => r.Status === 'active')
    const byPath = Object.fromEntries(rows.map((r) => [r.Values.path, r.Values]))
    expect(Object.keys(byPath).sort()).toEqual(['ping.bru', 'users/create.bru'])
    expect(byPath['ping.bru']).toMatchObject({ name: 'ping', method: 'GET', status: 'pass', httpStatus: '200' })
    expect(byPath['users/create.bru']).toMatchObject({ status: 'fail', httpStatus: '500', error: 'assertion failed' })
  } finally {
    await callBindingViaRPC(page, `${CONFIGURE}.DeleteExecEnv`, [env.ID]).catch(() => undefined)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
