import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BRIDGE_PORT_OFFSET,
  BROWSER_EXTENSION_MV3_MCP_BASE_PORT,
  BROWSER_EXTENSION_MV3_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { openSettings } from './fixtures/settingsNav'
import { runSeededWorkflow, approveTheParkedRun } from './fixtures/browserReplay'

// The real thing behind goal 0418's fix, not the wire-protocol stand-in
// every other browser spec drives (fixtures/fakeExtension.ts): a real
// unpacked MV3 extension, loaded into its own persistent Chromium
// profile via Playwright's own documented chrome-extensions path
// (--disable-extensions-except/--load-extension), paired through its
// real popup and Mill's real Settings accept, force-stopped at
// chrome://serviceworker-internals (Chrome's own documented way to test
// service-worker termination-and-wake), and then asked to run a replay
// -- proving the worker comes back and the run succeeds within
// beginRun's own wait window after a real idle teardown, not only the
// stand-in's imagined one.
//
// This exact live setup also caught a real bug the fake-extension
// specs never could: coder/websocket's default Origin check rejected
// EVERY real chrome-extension:// handshake outright (a
// "chrome-extension://<id>" Origin's own "host" is the extension id,
// never this listener's 127.0.0.1:port) -- the WebSocket connection
// was failing from the very first pair, popup "Connected to Mill"
// notwithstanding (it reads the pairing response, not the socket).
// bridgeservice_ws.go's handleWS now binds coder/websocket's own
// OriginPatterns to the credential's own recorded Origin instead;
// the bearer token checked before Accept is this route's real
// boundary, the same posture host_permissions fetches already have
// with CORS.
//
// Chromium only loads an unpacked extension in HEADED mode -- verified
// live against this exact bundle: default headless launch never
// registers a service worker at all (waitForEvent times out), headed
// does. CI's e2e job runs on a headless Ubuntu runner with no display,
// so this spec launches headless there (matching real CI conditions)
// and headed everywhere else; either way it checks the ACTUAL outcome
// (a service worker registering) rather than trusting the CI flag
// alone, and skips with a named reason when it doesn't.
//
// Dedicated server + its own persistent context: nothing else in the
// suite should share a browser profile or a bridge listener this test
// can leave with a stopped service worker.

const EXTENSION_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'examples', 'browser-extension')

// One alarm cycle (chrome.alarms' own 30s floor) plus the run itself,
// on top of Chromium/extension load and the pairing round trip.
test.setTimeout(180_000)

// eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
test('a real extension worker stopped mid-idle wakes on its own and the parked run succeeds', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-mv3-${idx}-`))
  const userDataDir = mkdtempSync(path.join(tmpdir(), `mill-e2e-mv3-profile-${idx}-`))
  const port = BROWSER_EXTENSION_MV3_SERVER_BASE_PORT + idx
  const bridgePort = port + BRIDGE_PORT_OFFSET
  const bridgeURL = `http://127.0.0.1:${bridgePort}`

  let server: SpawnedServer | undefined
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: !!process.env.CI,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
    ],
  })
  try {
    let worker = context.serviceWorkers()[0]
    if (!worker) {
      try {
        worker = await context.waitForEvent('serviceworker', { timeout: 10_000 })
      } catch {
        test.skip(true, 'This Chromium build never registered the extension\'s service worker (typically headless CI) -- run this spec headed locally, or see the manual-checks skill for the installed-app proof.')
        return
      }
    }
    const extensionID = worker.url().split('/')[2]

    server = await spawnMillServer({
      port,
      mcpPort: BROWSER_EXTENSION_MV3_MCP_BASE_PORT + idx,
      bridgePort,
      settingsPath: path.join(dir, 'settings.json'),
      executionDbPath: path.join(dir, 'execution.db'),
      backupDir: path.join(dir, 'backups'),
    })
    const testPageURL = `${bridgeURL}/__mill/bridge/test-page`

    const millPage = await context.newPage()
    await millPage.goto(`${server.baseURL}/`)

    // 1. Point the real popup at THIS server's bridge address, then
    //    pair through it for real: "Pair with Mill" mints the nearby-
    //    flow request, and accepting it in Mill's own Settings is what
    //    a person actually does.
    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${extensionID}/popup.html`)
    // Real chrome.storage.local, in this real extension's own origin --
    // no stub, unlike browser-extension-popup.spec.ts's static-page
    // harness. Pointed at THIS test's own bridge port before the first
    // discover() call, so "Pair with Mill" talks to the right server.
    await popup.evaluate(async (address) => {
      const runtimeChrome = (window as unknown as { chrome: { storage: { local: { set: (obj: Record<string, unknown>) => Promise<void> } } } }).chrome
      await runtimeChrome.storage.local.set({ millBridge: { address } })
    }, bridgeURL)
    await popup.reload()
    await expect(popup.locator('#view-unpaired')).toBeVisible()
    await popup.locator('#pair-with-mill').click()
    await expect(popup.locator('#view-waiting')).toBeVisible()

    await openSettings(millPage, 'connections')
    await expect(millPage.getByTestId('browser-pair-request-card')).toBeVisible({ timeout: 5_000 })
    await millPage.getByTestId('browser-pair-request-accept').click()
    await expect(popup.locator('#view-connected')).toBeVisible({ timeout: 5_000 })
    await expect(millPage.getByTestId('paired-browser-row')).toContainText('Chrome')

    // 2. Force-stop the worker exactly as Chrome's own idle timer would
    //    -- paired, then idle long enough for the platform to tear the
    //    worker down, without an actual multi-minute wait.
    //    chrome://serviceworker-internals lists a second row for Mill's
    //    own web-app service worker (unrelated) -- only the row scoped
    //    to this extension is stopped.
    const internals = await context.newPage()
    await internals.goto('chrome://serviceworker-internals')
    const extensionRow = internals.locator('.serviceworker-registration').filter({
      has: internals.locator('.serviceworker-scope .value', { hasText: extensionID }),
    })
    const stopButton = extensionRow.locator('cr-button[data-command="stop"]')
    await expect(stopButton).toBeEnabled({ timeout: 10_000 })
    await stopButton.click()
    await expect(extensionRow.locator('.serviceworker-running-status .value')).toHaveText('STOPPED', { timeout: 10_000 })
    await internals.close()

    // 3. Reopen the popup: it reads paired-but-not-connected and sends
    //    the reconnect nudge decision 4 wired (chrome.runtime.
    //    sendMessage) -- a real, immediate platform wake event on
    //    message delivery, backing up chrome.alarms' own 30s-floor
    //    cycle, which would otherwise reach the same result on its own
    //    within the run's wait window below.
    await popup.reload()
    await expect(popup.locator('#view-reconnecting')).toBeVisible({ timeout: 10_000 })

    // 4. Run the seeded example against the worker that just died.
    //    beginRun waits for the reconnect the popup above triggered --
    //    proving a run started the moment the worker died no longer
    //    fails immediately.
    await runSeededWorkflow(millPage, testPageURL, 'hello from the real extension')
    await approveTheParkedRun(millPage)
    // SUCCESS is DBOS's own terminal status token (runStatusLabel,
    // shared/runTime.ts) -- reaching it proves the run neither failed
    // with "no browser" nor hung waiting past beginRun's own window.
    await expect(millPage.getByTestId('run-detail')).toContainText('SUCCESS', { timeout: 90_000 })
    await expect(popup.locator('#view-connected')).toBeVisible({ timeout: 5_000 })
  } finally {
    await server?.stop()
    await context.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(userDataDir, { recursive: true, force: true })
  }
})
