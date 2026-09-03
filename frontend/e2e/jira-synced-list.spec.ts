import { test, expect } from './fixtures/server'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { callBindingViaRPC } from './fixtures/wailsRpc'

// The synced List (goal 0299): the seeded "Example: Jira issues → List"
// workflow, pointed at a fake Jira answering the JQL search endpoint,
// mirrors issues into the seeded List by key; a second run updates a
// changed status in place; the fake sees only GETs -- one-way by
// construction. Driven through the same bound calls the Configure
// forms and the Run button make; the rows are read back through
// GetList and shown on Configure's List page. Shared worker pool: the
// request's base URL and the workflow's disabled flag are put back,
// and the rows removed.
const CONFIGURE = 'github.com/alicoding/mill/internal/services/configuresvc.ConfigureService'
const COMPOSITION = 'github.com/alicoding/mill/internal/services/compositionsvc.CompositionService'
const EXECUTION = 'github.com/alicoding/mill/internal/services/executionsvc.ExecutionService'
const REQUEST_ID = 'example-jira-search'
const WORKFLOW_ID = 'example-jira-issues-sync-workflow'
const LIST_ID = 'example-jira-issues-list'

type HTTPRequestRecord = { ID: string; Label: string; BaseURL: string; Method: string; Body: string; AuthType: string; Headers: Record<string, string> | null; OpenAPISpec: string; Auth: unknown; JOSE: unknown; Description: string }

test('the seeded Jira sync mirrors a fake search into the List by key, updates in place on the next run, and never writes back', async ({ page }) => {
  let status = 'In Progress'
  const methods: string[] = []
  const http = createServer((req, res) => {
    methods.push(req.method ?? '')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ total: 2, issues: [
      { key: 'ZZE2E-1', fields: { summary: 'Ship the sync', status: { name: status }, assignee: { displayName: 'Ali' }, updated: '2026-09-03T01:00:00.000+0000' } },
      { key: 'ZZE2E-2', fields: { summary: 'Write the docs', status: { name: 'To Do' }, assignee: null, updated: '2026-09-02T00:00:00.000+0000' } },
    ] }))
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const port = (http.address() as AddressInfo).port

  await page.goto('/')
  const requests = await callBindingViaRPC<HTTPRequestRecord[]>(page, `${CONFIGURE}.HTTPRequests`, [])
  const seeded = requests.find((r) => r.ID === REQUEST_ID)
  if (!seeded) throw new Error('the seeded Jira search request is missing')
  const update = (baseURL: string) => callBindingViaRPC(page, `${CONFIGURE}.UpdateHTTPRequest`, [
    seeded.ID, seeded.Label, baseURL, seeded.Method, seeded.Body, seeded.AuthType, seeded.Headers ?? {}, seeded.OpenAPISpec, seeded.Auth ?? null, seeded.JOSE ?? null, seeded.Description,
  ])
  // The HTTP step is an external effect: it parks for approval like
  // any other, and the test approves it the way Review does.
  const runAndWait = async () => {
    const run = await callBindingViaRPC<{ runID: string }>(page, `${EXECUTION}.RunWorkflow`, [WORKFLOW_ID, 'test', {}])
    const status = async () => {
      const detail = await callBindingViaRPC<{ status?: string; Status?: string }>(page, `${EXECUTION}.GetRun`, [run.runID])
      return (detail.status ?? detail.Status ?? '').toUpperCase()
    }
    await expect.poll(status, { timeout: 30_000 }).toMatch(/PENDING|SUCCESS|SUCCEEDED|DONE/)
    if ((await status()) === 'PENDING') {
      await callBindingViaRPC(page, `${EXECUTION}.ResolveApproval`, [run.runID, 'atlassian-jira-sync-http', true, {}, true])
    }
    await expect.poll(status, { timeout: 30_000 }).toMatch(/SUCCESS|SUCCEEDED|DONE/)
  }
  const rows = async () => {
    const list = await callBindingViaRPC<{ Rows: { ID: string; Status: string; Values: Record<string, string> }[] | null }>(page, `${CONFIGURE}.GetList`, [LIST_ID])
    return list.Rows ?? []
  }
  try {
    await update(`http://127.0.0.1:${port}`)
    await callBindingViaRPC(page, `${CONFIGURE}.SetHTTPRequestSecret`, [REQUEST_ID, 'fake-pat'])
    await callBindingViaRPC(page, `${COMPOSITION}.SetWorkflowDisabled`, [WORKFLOW_ID, false])

    await runAndWait()
    let got = await rows()
    const byKey = (r: typeof got) => Object.fromEntries(r.map((x) => [x.Values.key, x]))
    expect(Object.keys(byKey(got)).sort()).toEqual(['ZZE2E-1', 'ZZE2E-2'])
    expect(byKey(got)['ZZE2E-1'].Values.status).toBe('In Progress')
    expect(byKey(got)['ZZE2E-1'].Values.url).toBe('https://jira.example.com/browse/ZZE2E-1')
    expect(byKey(got)['ZZE2E-2'].Values.assignee).toBe('')

    // The source moved on; the same row updates, nothing duplicates.
    status = 'Done'
    await runAndWait()
    got = await rows()
    expect(got).toHaveLength(2)
    expect(byKey(got)['ZZE2E-1'].Values.status).toBe('Done')
    expect(byKey(got)['ZZE2E-1'].Status).toBe('active')
    expect(methods.every((m) => m === 'GET')).toBe(true)

    // The mirror is a List like any other: Configure shows the rows.
    await page.getByRole('link', { name: 'Configure' }).click()
    await page.getByRole('tab', { name: 'Lists' }).click()
    const row = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Example: Jira issues', { exact: true }) })
    await row.getByText('Example: Jira issues', { exact: true }).click()
    await expect(page.getByTestId('list-rows-editor')).toContainText('Ship the sync')
  } finally {
    await callBindingViaRPC(page, `${COMPOSITION}.SetWorkflowDisabled`, [WORKFLOW_ID, true]).catch(() => undefined)
    await update(seeded.BaseURL).catch(() => undefined)
    for (const r of await rows().catch(() => [])) {
      await callBindingViaRPC(page, `${CONFIGURE}.DeleteListRow`, [LIST_ID, r.ID]).catch(() => undefined)
    }
    await new Promise<void>((resolve) => http.close(() => resolve()))
  }
})
