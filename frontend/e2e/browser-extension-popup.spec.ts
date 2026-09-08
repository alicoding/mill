import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
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
// other spec's range (testing.md: worker ranges 9400+/9500+, the
// highest dedicated pair committed today is 12040/12060).
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
    if (url.pathname === '/__mill/bridge/discover' && req.method === 'GET') {
      const paired = Boolean(state.token) && req.headers.authorization === `Bearer ${state.token}`
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ name: 'Mill', paired }))
      return
    }
    if (url.pathname === '/__mill/bridge/pair-request' && req.method === 'POST') {
      state.pairRequestStatus = 'pending'
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ requestId: 'req-1', code: '482913', expiresAt: new Date(Date.now() + 120_000).toISOString() }))
      return
    }
    if (url.pathname === '/__mill/bridge/pair-status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      const body: Record<string, string> = { status: state.pairRequestStatus }
      if (state.pairRequestStatus === 'accepted') {
        body.token = state.token
        body.deviceId = 'browser-1'
        body.label = state.label
      }
      res.end(JSON.stringify(body))
      return
    }
    res.writeHead(404).end()
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

// Shims chrome.storage.local with an in-memory object before popup.js's
// own top-level `void init()` runs -- there is no real extension
// context in a plain page.
async function withPopup(browser: Browser, popupURL: string, seedStorage: Record<string, unknown> = {}): Promise<Page> {
  const page = await browser.newPage()
  await page.addInitScript((seed) => {
    const store: Record<string, unknown> = { millBridge: seed }
    ;(window as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: store[key] }),
          set: async (obj: Record<string, unknown>) => { Object.assign(store, obj) },
        },
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
    const state: BridgeState = { pairRequestStatus: 'pending', token: '', label: '' }
    const bridgeServer = await serveBridge(bridgePort, state)
    const browser = await chromium.launch()
    try {
      const page = await withPopup(browser, `http://127.0.0.1:${staticPort}/popup.html`, { address: `http://127.0.0.1:${bridgePort}` })
      await expect(page.locator('#view-unpaired')).toBeVisible()
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
    const state: BridgeState = { pairRequestStatus: 'pending', token: 'minted-token', label: 'Chrome' }
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
    const state: BridgeState = { pairRequestStatus: 'pending', token: '', label: '' }
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
    const state: BridgeState = { pairRequestStatus: 'pending', token: 'already-good', label: 'Firefox' }
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

      // Disconnect clears the local credential and falls back to the
      // unpaired form -- no bridge door revokes it from this side.
      await page.locator('#disconnect').click()
      await expect(page.locator('#view-unpaired')).toBeVisible()
    } finally {
      await browser.close()
      await new Promise((resolve) => bridgeServer.close(resolve))
    }
  })
})
