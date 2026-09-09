import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { applyCpuThrottle } from './fixtures/throttle'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// examples/browser-extension/popup.js is a plain DOM script (no
// exported pure function to import into Vitest -- popup.js's own
// state lives entirely behind chrome.storage/fetch side effects), so
// its own state machine is proven here instead: a real headless
// Chromium loads the real popup.html/popup.js, against a stub HTTP
// server standing in for Mill's bridge (never Mill itself -- Go's own
// side of the nearby flow is proven by remoteauthsvc/bridgesvc's unit
// tests and browser-bridge.spec.ts's real-server round trip). Neither
// port is a spawnMillServer pair, so it lives outside serverPorts.ts;
// STATIC_PORT_BASE/BRIDGE_PORT_BASE just need to sit above every
// other spec's own dedicated range (testing.md documents where the
// worker pool and every dedicated pair live).
const STATIC_PORT_BASE = 12100
const BRIDGE_PORT_BASE = 12120

const EXTENSION_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'examples', 'browser-extension')

function serveStatic(port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const file = req.url === '/' || req.url === '/popup.html' ? 'popup.html' : req.url === '/popup.js' ? 'popup.js' : null
    if (!file) {
      res.writeHead(404).end()
      return
    }
    const contentType = file.endsWith('.js') ? 'application/javascript' : 'text/html'
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(fs.readFileSync(path.join(EXTENSION_DIR, file)))
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

// bridgeState is what a real Mill would answer -- a test flips it
// mid-flow to simulate Accept/Deny/expiry happening on Mill's side,
// the same way a human clicking Accept in Settings would. paired is
// derived from the bearer the popup actually sends, like the real
// discover endpoint (remoteauthsvc.ValidateBrowserToken) -- never a
// flag set independent of the credential, or Disconnect's own re-check
// couldn't be told apart from a still-live pairing.
interface BridgeState {
  pairRequestStatus: 'pending' | 'accepted' | 'denied' | 'expired'
  token: string
  label: string
  // connected stands in for a live socket (goal 0418): discover()
  // reports it only alongside a matching paired token, the same
  // paired-and-connected-are-two-facts split the real bridge answers.
  connected: boolean
  // disconnectCalls pins that the popup's own Disconnect really POSTs
  // the self-revoke door (goal 0379 S2), not just a local clear.
  disconnectCalls: number
}

type BridgeRouteHandler = (req: IncomingMessage, res: ServerResponse, state: BridgeState) => void

function serveDiscover(req: IncomingMessage, res: ServerResponse, state: BridgeState): void {
  const paired = Boolean(state.token) && req.headers.authorization === `Bearer ${state.token}`
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ name: 'Mill', paired, connected: paired && state.connected }))
}

function servePairRequest(req: IncomingMessage, res: ServerResponse, state: BridgeState): void {
  state.pairRequestStatus = 'pending'
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ requestId: 'req-1', code: '482913', expiresAt: new Date(Date.now() + 120_000).toISOString() }))
}

function servePairStatus(req: IncomingMessage, res: ServerResponse, state: BridgeState): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  const body: Record<string, string> = { status: state.pairRequestStatus }
  if (state.pairRequestStatus === 'accepted') {
    body.token = state.token
    body.deviceId = 'browser-1'
    body.label = state.label
  }
  res.end(JSON.stringify(body))
}

function serveDisconnect(req: IncomingMessage, res: ServerResponse, state: BridgeState): void {
  state.disconnectCalls += 1
  const authorized = Boolean(state.token) && req.headers.authorization === `Bearer ${state.token}`
  if (!authorized) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'unauthorized' }))
    return
  }
  state.token = ''
  res.writeHead(204).end()
}

// One handler per method+path, dispatched below -- keeps serveBridge's
// own request handler a flat lookup rather than a growing if/else
// chain (each route's own logic, and its own cognitive-complexity
// budget, lives with its handler).
const BRIDGE_ROUTES: Record<string, BridgeRouteHandler> = {
  'GET /__mill/bridge/discover': serveDiscover,
  'POST /__mill/bridge/pair-request': servePairRequest,
  'GET /__mill/bridge/pair-status': servePairStatus,
  'POST /__mill/bridge/disconnect': serveDisconnect,
}

function serveBridge(port: number, state: BridgeState): Promise<http.Server> {
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    // A permissive CORS stand-in: the real bridge needs none of this
    // (an extension's host_permissions fetch is never subject to CORS),
    // but this stub is reached from a plain http:// page on a
    // different port to isolate "is Mill reachable" from "is the
    // popup loadable" -- a real cross-origin fetch, so the preflight
    // needs an answer.
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
    const handler = BRIDGE_ROUTES[`${req.method} ${url.pathname}`]
    if (!handler) {
      res.writeHead(404).end()
      return
    }
    handler(req, res, state)
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

// Shims chrome.storage.local and chrome.runtime.sendMessage with an
// in-memory object before popup.js's own top-level `void init()` runs
// -- there is no real extension context in a plain page.
// reconnectMessages (window.__reconnectMessages) is how a test reads
// back whether the popup's own reconnect nudge (goal 0418) was sent.
async function withPopup(browser: Browser, popupURL: string, seedStorage: Record<string, unknown> = {}): Promise<Page> {
  const page = await browser.newPage()
  await applyCpuThrottle(page)
  await page.addInitScript((seed) => {
    const store: Record<string, unknown> = { millBridge: seed }
    const reconnectMessages: unknown[] = []
    ;(window as unknown as { __reconnectMessages: unknown[] }).__reconnectMessages = reconnectMessages
    ;(window as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: store[key] }),
          set: async (obj: Record<string, unknown>) => { Object.assign(store, obj) },
        },
      },
      runtime: {
        sendMessage: (message: unknown) => { reconnectMessages.push(message) },
      },
    }
  }, seedStorage)
  await page.goto(popupURL)
  return page
}

test.describe('the extension popup (goal 0379)', () => {
  let staticServer: http.Server
  let staticPort: number

  // eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
  test.beforeAll(async ({}, testInfo) => {
    staticPort = STATIC_PORT_BASE + testInfo.parallelIndex
    staticServer = await serveStatic(staticPort)
  })
  test.afterAll(async () => {
    await new Promise((resolve) => staticServer.close(resolve))
  })

  // eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
  test('Mill closed: only "Open Mill on this computer to pair." shows', async ({}, testInfo) => {
    const bridgePort = BRIDGE_PORT_BASE + testInfo.parallelIndex
    const browser = await chromium.launch()
    try {
      const page = await withPopup(browser, `http://127.0.0.1:${staticPort}/popup.html`, { address: `http://127.0.0.1:${bridgePort}` })
      await expect(page.locator('#view-closed')).toBeVisible()
      await expect(page.locator('#view-closed')).toHaveText('Open Mill on this computer to pair.')
      await expect(page.locator('#view-unpaired')).toBeHidden()
      await expect(page.locator('#view-connected')).toBeHidden()
    } finally {
      await browser.close()
    }
  })

  // eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
  test('unpaired: "Pair with Mill" leads, "Enter a code instead" stays reachable', async ({}, testInfo) => {
    const bridgePort = BRIDGE_PORT_BASE + 20 + testInfo.parallelIndex
    const state: BridgeState = { pairRequestStatus: 'pending', token: '', label: '', connected: false, disconnectCalls: 0 }
    const bridgeServer = await serveBridge(bridgePort, state)
    const browser = await chromium.launch()
    try {
      const page = await withPopup(browser, `http://127.0.0.1:${staticPort}/popup.html`, { address: `http://127.0.0.1:${bridgePort}` })
      await expect(page.locator('#view-unpaired')).toBeVisible()
      await expect(page.locator('#view-unpaired .view-title')).toHaveText('Not paired')
      await expect(page.locator('#pair-with-mill')).toHaveText('Pair with Mill')
      await expect(page.getByText('Enter a code instead')).toBeVisible()
    } finally {
      await browser.close()
      await new Promise((resolve) => bridgeServer.close(resolve))
    }
  })

  // eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
  test('Pair with Mill: waiting shows the code, Accept in Mill connects', async ({}, testInfo) => {
    const bridgePort = BRIDGE_PORT_BASE + 40 + testInfo.parallelIndex
    const state: BridgeState = { pairRequestStatus: 'pending', token: 'minted-token', label: 'Chrome', connected: true, disconnectCalls: 0 }
    const bridgeServer = await serveBridge(bridgePort, state)
    const browser = await chromium.launch()
    try {
      const page = await withPopup(browser, `http://127.0.0.1:${staticPort}/popup.html`, { address: `http://127.0.0.1:${bridgePort}` })
      await page.locator('#pair-with-mill').click()
      await expect(page.locator('#view-waiting')).toBeVisible()
      await expect(page.locator('#waiting-code')).toHaveText('482913')

      // Accept in Mill: the popup's own 1s poll picks it up.
      state.pairRequestStatus = 'accepted'
      await expect(page.locator('#view-connected')).toBeVisible({ timeout: 5_000 })
      await expect(page.locator('.connected-title')).toHaveText('Connected to Mill.')
      await expect(page.locator('#connected-label')).toHaveText('Chrome')
    } finally {
      await browser.close()
      await new Promise((resolve) => bridgeServer.close(resolve))
    }
  })

  // eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
  test('Deny in Mill: the popup falls back to "Pair with Mill", no retry loop', async ({}, testInfo) => {
    const bridgePort = BRIDGE_PORT_BASE + 60 + testInfo.parallelIndex
    const state: BridgeState = { pairRequestStatus: 'pending', token: '', label: '', connected: false, disconnectCalls: 0 }
    const bridgeServer = await serveBridge(bridgePort, state)
    const browser = await chromium.launch()
    try {
      const page = await withPopup(browser, `http://127.0.0.1:${staticPort}/popup.html`, { address: `http://127.0.0.1:${bridgePort}` })
      await page.locator('#pair-with-mill').click()
      await expect(page.locator('#view-waiting')).toBeVisible()

      state.pairRequestStatus = 'denied'
      await expect(page.locator('#view-unpaired')).toBeVisible({ timeout: 5_000 })
      await expect(page.locator('#unpaired-message')).toHaveText('Pairing declined in Mill.')
    } finally {
      await browser.close()
      await new Promise((resolve) => bridgeServer.close(resolve))
    }
  })

  // eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
  test('connected: discover(paired:true) skips straight past the form', async ({}, testInfo) => {
    const bridgePort = BRIDGE_PORT_BASE + 80 + testInfo.parallelIndex
    const state: BridgeState = { pairRequestStatus: 'pending', token: 'already-good', label: 'Firefox', connected: true, disconnectCalls: 0 }
    const bridgeServer = await serveBridge(bridgePort, state)
    const browser = await chromium.launch()
    try {
      const page = await withPopup(browser, `http://127.0.0.1:${staticPort}/popup.html`, {
        address: `http://127.0.0.1:${bridgePort}`,
        token: 'already-good',
        label: 'Firefox',
      })
      await expect(page.locator('#view-connected')).toBeVisible()
      await expect(page.locator('#connected-label')).toHaveText('Firefox')
      await expect(page.locator('#view-unpaired')).toBeHidden()

      // "Show details" is the only place the address appears once
      // connected.
      await expect(page.locator('#connected-address')).toBeHidden()
      await page.getByText('Show details').click()
      await expect(page.locator('#connected-address')).toHaveText(`http://127.0.0.1:${bridgePort}`)

      // Disconnect ends the pairing in Mill too (goal 0379 S2): the
      // door is called with this browser's own bearer token before the
      // local credential clears, and the popup falls back to the
      // unpaired form.
      await page.locator('#disconnect').click()
      await expect(page.locator('#view-unpaired')).toBeVisible()
      expect(state.disconnectCalls).toBe(1)
      expect(state.token).toBe('')
    } finally {
      await browser.close()
      await new Promise((resolve) => bridgeServer.close(resolve))
    }
  })

  // eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
  test('Disconnect with Mill down: the credential still clears locally', async ({}, testInfo) => {
    const bridgePort = BRIDGE_PORT_BASE + 100 + testInfo.parallelIndex
    const state: BridgeState = { pairRequestStatus: 'pending', token: 'already-good', label: 'Firefox', connected: true, disconnectCalls: 0 }
    const bridgeServer = await serveBridge(bridgePort, state)
    const browser = await chromium.launch()
    try {
      const page = await withPopup(browser, `http://127.0.0.1:${staticPort}/popup.html`, {
        address: `http://127.0.0.1:${bridgePort}`,
        token: 'already-good',
        label: 'Firefox',
      })
      await expect(page.locator('#view-connected')).toBeVisible()

      // Mill goes away entirely before Disconnect is pressed -- the
      // popup's own POST to the door will fail to connect.
      await new Promise((resolve) => bridgeServer.close(resolve))

      await page.locator('#disconnect').click()
      // Wait for the click handler's own async work (the failed door
      // call, the local clear, the re-run discover) to settle before
      // reading storage back -- click() resolves on the dispatch, not
      // on the handler's promise.
      await expect(page.locator('#view-connected')).toBeHidden()
      // Local storage clears regardless of the door's own
      // reachability -- disconnecting must never depend on Mill being
      // reachable right now.
      const stored = (await page.evaluate(async () => {
        const chromeShim = (window as unknown as { chrome: { storage: { local: { get: (key: string) => Promise<Record<string, unknown>> } } } }).chrome
        const data = await chromeShim.storage.local.get('millBridge')
        return data.millBridge
      })) as { token?: string } | undefined
      expect(stored?.token).toBeUndefined()
    } finally {
      await browser.close()
    }
  })

  // eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
  test('paired, not connected: "Paired, reconnecting…" shows, the popup nudges the worker, then follows it to Connected', async ({}, testInfo) => {
    const bridgePort = BRIDGE_PORT_BASE + 120 + testInfo.parallelIndex
    const state: BridgeState = { pairRequestStatus: 'pending', token: 'already-good', label: 'Firefox', connected: false, disconnectCalls: 0 }
    const bridgeServer = await serveBridge(bridgePort, state)
    const browser = await chromium.launch()
    try {
      const page = await withPopup(browser, `http://127.0.0.1:${staticPort}/popup.html`, {
        address: `http://127.0.0.1:${bridgePort}`,
        token: 'already-good',
        label: 'Firefox',
      })
      await expect(page.locator('#view-reconnecting')).toBeVisible()
      await expect(page.locator('.reconnecting-title')).toHaveText('Paired, reconnecting…')
      await expect(page.locator('#view-connected')).toBeHidden()
      await expect(page.locator('#view-unpaired')).toBeHidden()

      // Opening the popup nudged the (stubbed) worker to reconnect --
      // a real user action that always reaches even a fully terminated
      // worker.
      await expect.poll(() =>
        page.evaluate(() => (window as unknown as { __reconnectMessages: unknown[] }).__reconnectMessages.length),
      ).toBeGreaterThan(0)

      // The worker reconnects (its own alarm/message trigger in the
      // real extension) -- the popup's own 2s poll picks it up with no
      // further action here.
      state.connected = true
      await expect(page.locator('#view-connected')).toBeVisible({ timeout: 5_000 })
      await expect(page.locator('#connected-label')).toHaveText('Firefox')
    } finally {
      await browser.close()
      await new Promise((resolve) => bridgeServer.close(resolve))
    }
  })
})
