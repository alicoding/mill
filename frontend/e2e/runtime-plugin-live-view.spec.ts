// The bundled mill-live-view plugin (goal 0374): a board-switcher pane
// reading rows from a Configure Integration entity, with guarded reply
// and status-change writes whose "ask" outcome is confirmed by Mill's
// OWN chrome outside the sandboxed frame -- never a fake confirm the
// frame could assert itself. Shared worker pool: this test creates its
// own HTTPRequest (never the seeded example) and its own plugin
// setting, both deleted in a finally block -- no global state read.
//
// The stub server is a real, local node:http server standing in for
// "a tracked-items tool" (jira-synced-list.spec.ts's own precedent for
// this shape) -- never a real vendor, matching goal 0374 item 6.
import { test, expect } from './fixtures/server'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { gotoAppReady } from './fixtures/appReady'
import { openExtensionDetail, openExtensions, pluginRow } from './fixtures/settingsNav'

const CONFIGURE = 'github.com/alicoding/mill/internal/services/configuresvc.ConfigureService'
const SETTINGS = 'github.com/alicoding/mill/internal/services/settingssvc.SettingsService'
const GUARDRAIL = 'github.com/alicoding/mill/internal/services/guardrailsvc.GuardrailService'
const PLUGIN_ID = 'mill-live-view'
const VIEW_HOST_TESTID = 'plugin-view-mill-live-view-live-view'
const SWITCHER_TESTID = 'atlas-open-plugin-mill-live-view-live-view'

const TRACKED_ITEMS_SPEC = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Tracked items', version: '1.0.0' },
  paths: {
    '/search': { get: { summary: 'Search items', parameters: [{ name: 'q', in: 'query', required: false, schema: { type: 'string' } }], responses: { 200: { description: 'OK' } } } },
    '/items/{itemKey}/transitions': {
      get: { summary: 'List allowed transitions', parameters: [{ name: 'itemKey', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' } } },
      post: { summary: 'Move to a new status', parameters: [{ name: 'itemKey', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { toStatus: { type: 'string' } } } } } }, responses: { 200: { description: 'OK' } } },
    },
    '/items/{itemKey}/comments': { post: { summary: 'Post a comment', parameters: [{ name: 'itemKey', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { body: { type: 'string' } } } } } }, responses: { 200: { description: 'OK' } } } },
  },
})

// TRANSITIONS is the stub's own workflow graph: To Do -> In Progress ->
// Done, with In Progress able to move back to To Do -- enough to
// exercise both "a transition happened" and "the reverse is allowed"
// (Undo) in one run.
const TRANSITIONS: Record<string, string[]> = { 'To Do': ['In Progress'], 'In Progress': ['To Do', 'Done'], Done: [] }

test('the live view lists rows from the stub, posts a comment through the inline ask, changes status, and offers Undo only when allowed', async ({ page }, testInfo) => {
  const comments: string[] = []
  let status = 'To Do'
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'GET' && url.pathname === '/search') {
      res.end(JSON.stringify({ items: [
        { key: 'PROJ-1', title: 'Ship the live view', status, assignee: 'Ali', updated: '2026-09-08T09:00:00.000Z', url: 'https://example.invalid/browse/PROJ-1' },
      ] }))
      return
    }
    if (url.pathname === '/items/PROJ-1/transitions') {
      if (req.method === 'GET') { res.end(JSON.stringify({ current: status, allowed: TRANSITIONS[status] ?? [] })); return }
      if (req.method === 'POST') {
        let raw = ''
        req.on('data', (c) => { raw += c })
        req.on('end', () => {
          const body = JSON.parse(raw || '{}') as { toStatus?: string }
          if (body.toStatus) status = body.toStatus
          res.end(JSON.stringify({ ok: true }))
        })
        return
      }
    }
    if (req.method === 'POST' && url.pathname === '/items/PROJ-1/comments') {
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', () => {
        const body = JSON.parse(raw || '{}') as { body?: string }
        comments.push(body.body ?? '')
        res.end(JSON.stringify({ ok: true }))
      })
      return
    }
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const label = `ZzE2eTrackedItems-${testInfo.workerIndex}`

  await gotoAppReady(page)

  type HTTPRequestRecord = { ID: string }
  const created = await callBindingViaRPC<HTTPRequestRecord>(page, `${CONFIGURE}.CreateHTTPRequest`, [
    label, `http://127.0.0.1:${port}`, 'GET', '', 'none', '', {}, TRACKED_ITEMS_SPEC, null, null, 'e2e stub',
  ])

  try {
    await callBindingViaRPC(page, `${SETTINGS}.SetExtensionSetting`, [PLUGIN_ID, 'integrationId', JSON.stringify(created.ID)])

    // The Integration setting is entityRef (goal 0400): its row renders
    // the SAME picker a node ConfigField of RefKind "request" uses,
    // showing the seeded Integration's own label, never its id.
    // mill-live-view is bundled (Builtin), so its detail pane has no
    // tab strip -- declared settings render straight into the one pane
    // (ExtensionDetailPane's own body, unlike an installed plugin's
    // settings tab).
    await openExtensions(page)
    const detail = await openExtensionDetail(page, pluginRow(page, PLUGIN_ID), PLUGIN_ID)
    const integrationRow = detail.getByTestId(`extension-setting-${PLUGIN_ID}-integrationId`)
    await expect(integrationRow).toHaveAttribute('data-setting-type', 'entityRef')
    const integrationSelect = integrationRow.getByTestId('entity-ref-field')
    await expect(integrationSelect).toHaveValue(created.ID)
    await expect(integrationSelect.locator('option:checked')).toHaveText(label)

    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(page.getByTestId('atlas-board')).toBeVisible()
    await page.getByTestId(SWITCHER_TESTID).click()

    const host = page.getByTestId(VIEW_HOST_TESTID)
    await expect(host).toBeVisible()
    const frame = page.frameLocator(`[data-testid="${VIEW_HOST_TESTID}"]`)

    // Rows loaded from the stub's /search.
    await expect(frame.getByText('Ship the live view')).toBeVisible()
    await expect(frame.getByText('PROJ-1')).toBeVisible()

    // Selecting the row loads its current status and allowed transitions.
    await frame.getByText('Ship the live view').click()
    const currentStatus = frame.getByTestId('live-view-current-status')
    await expect(currentStatus).toHaveText('To Do')
    await expect(frame.getByRole('button', { name: 'Move to In Progress' })).toBeVisible()

    // Reply: no rule authored, so ClassExternal's own fail-safe asks --
    // the confirm banner is Mill's OWN chrome, drawn OUTSIDE the frame.
    await frame.getByPlaceholder('Reply').fill('On it')
    await frame.getByRole('button', { name: 'Post', exact: true }).click()
    const banner = page.getByTestId(`${VIEW_HOST_TESTID}-guarded-ask`)
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('Mill will post this to the tool.')
    await page.getByTestId(`${VIEW_HOST_TESTID}-guarded-ask-confirm`).click()
    await expect(frame.getByTestId('live-view-comment-sent')).toBeVisible()
    await expect.poll(() => comments).toEqual(['On it'])

    // Change status: the SAME inline banner mechanism, with the
    // transition's own verb as the confirm button's label.
    await frame.getByRole('button', { name: 'Move to In Progress' }).click()
    await expect(page.getByTestId(`${VIEW_HOST_TESTID}-guarded-ask`)).toContainText('Mill will post this to the tool.')
    await page.getByTestId(`${VIEW_HOST_TESTID}-guarded-ask-confirm`).click()
    await expect(currentStatus).toHaveText('In Progress')

    // Undo is offered because "In Progress" -> "To Do" is genuinely
    // allowed by the stub's own transition graph -- never a fake undo.
    const undoButton = frame.getByRole('button', { name: 'Undo — move back to To Do' })
    await expect(undoButton).toBeVisible()
    await undoButton.click()
    await page.getByTestId(`${VIEW_HOST_TESTID}-guarded-ask-confirm`).click()
    await expect(currentStatus).toHaveText('To Do')

    // An allow rule skips the banner entirely: straight to Sent.
    await callBindingViaRPC(page, `${GUARDRAIL}.CreateRule`, [{ Label: 'Allow live-view comments', Effect: 'allow', NodeTypeID: 'external.comment' }])
    await frame.getByPlaceholder('Reply').fill('Second reply, pre-approved')
    await frame.getByRole('button', { name: 'Post', exact: true }).click()
    await expect(page.getByTestId(`${VIEW_HOST_TESTID}-guarded-ask`)).toHaveCount(0)
    await expect(frame.getByTestId('live-view-comment-sent')).toBeVisible()
    await expect.poll(() => comments).toEqual(['On it', 'Second reply, pre-approved'])
  } finally {
    // The setting clears FIRST (goal 0400): the entityRef reference it
    // holds refuses the HTTPRequest's own delete while it's still
    // picked, the same block DeleteHTTPRequest's own tests cover.
    await callBindingViaRPC(page, `${SETTINGS}.SetExtensionSetting`, [PLUGIN_ID, 'integrationId', JSON.stringify('')])
    await callBindingViaRPC(page, `${CONFIGURE}.DeleteHTTPRequest`, [created.ID])
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
