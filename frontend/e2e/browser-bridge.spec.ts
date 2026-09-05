import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  BROWSER_BRIDGE_MCP_BASE_PORT,
  BROWSER_BRIDGE_SERVER_BASE_PORT,
  BRIDGE_PORT_OFFSET,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { connectFakeExtension, pairFakeExtension } from './fixtures/fakeExtension'
import { openSettings } from './fixtures/settingsNav'

// The browser bridge end to end (goal 0350 S1): pair a browser with a
// code, let it hold a stream open, and run the built-in connection test
// through it -- the real task the capability exists for, not just the
// elements the diff touched (.claude/rules/testing.md).
//
// Dedicated server: the paired-browser list and the bridge's connected
// count are GLOBAL app state, and this spec both adds to and revokes
// from them (testing.md's shared-vs-dedicated rule).
//
// The browser half is a stand-in speaking the real wire protocol
// (fixtures/fakeExtension.ts) rather than a real unpacked extension --
// see that file for why, and for where the runner's own logic is
// proven instead.

// eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
test('browser bridge: pair a browser, see it connect, test the connection, revoke it', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-bridge-${idx}-`))
  const port = BROWSER_BRIDGE_SERVER_BASE_PORT + idx
  const bridgePort = port + BRIDGE_PORT_OFFSET
  const bridgeURL = `http://127.0.0.1:${bridgePort}`

  let server: SpawnedServer | undefined
  let extension: { stop: () => void } | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({
      port,
      mcpPort: BROWSER_BRIDGE_MCP_BASE_PORT + idx,
      bridgePort,
      settingsPath: path.join(dir, 'settings.json'),
      executionDbPath: path.join(dir, 'execution.db'),
      backupDir: path.join(dir, 'backups'),
    })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await openSettings(page, 'connections')
    await expect(page.getByTestId('settings-section-browsers')).toBeVisible()

    // 1. Nothing paired: the section names the address a browser is
    //    pointed at, and offers the action its empty state describes.
    await expect(page.getByTestId('browsers-empty')).toBeVisible()
    await expect(page.getByTestId('bridge-address')).toHaveText(bridgeURL)
    await expect(page.getByTestId('test-browser-connection')).toBeDisabled()

    // 2. A code is minted, and the browser exchanges it for its token.
    await page.getByTestId('pair-a-browser').click()
    const code = (await page.getByTestId('browser-pairing-code').innerText()).trim()
    expect(code).toHaveLength(8)

    const token = await pairFakeExtension(bridgeURL, code, 'Chrome')
    expect(token).not.toEqual('')

    // A spent code cannot pair a second browser.
    await expect(pairFakeExtension(bridgeURL, code, 'Second')).rejects.toThrow(/pairing refused/)

    // 3. The browser opens its stream; Mill shows it paired and
    //    connected, and the test action becomes available.
    const replayPage = await browser.newPage()
    const client = connectFakeExtension(bridgeURL, token, replayPage)
    extension = client
    await client.ready

    await page.reload()
    await openSettings(page, 'connections')
    const row = page.getByTestId('paired-browser-row')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Chrome')
    await expect(page.getByTestId('browser-connection-state')).toHaveText('Connected')

    // 4. The connection test replays in the browser and reports back.
    const testButton = page.getByTestId('test-browser-connection')
    await expect(testButton).toBeEnabled()
    await testButton.click()
    await expect(page.getByTestId('browser-test-result')).toContainText('The browser replayed 3 steps in', { timeout: 60_000 })

    // The command really crossed the stream, carrying the recorded flow.
    const replays = client.received.filter((c) => c.kind === 'replay')
    expect(replays).toHaveLength(1)
    expect(replays[0].flow?.steps.map((s) => s.type)).toEqual(['navigate', 'click', 'waitForElement'])

    // 5. Revoking ends it: the row goes immediately.
    await page.getByTestId('revoke-browser').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke' }).click()
    await expect(page.getByTestId('browsers-empty')).toBeVisible()

    // 6. With the browser gone and its stream closed, the test action
    //    is unavailable again. Read on a fresh mount: the section
    //    fetches the connected count once per mount, and a stream the
    //    client just aborted is not something the open page re-polls.
    client.stop()
    await page.reload()
    await openSettings(page, 'connections')
    await expect(page.getByTestId('browsers-empty')).toBeVisible()
    await expect(page.getByTestId('test-browser-connection')).toBeDisabled()
  } finally {
    extension?.stop()
    await browser.close()
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
