import { chromium, expect, test, type Locator, type Page } from '@playwright/test'
import { applyCpuThrottle } from './fixtures/throttle'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  BRIDGE_PORT_OFFSET,
  BROWSER_REPLAY_MCP_BASE_PORT,
  BROWSER_REPLAY_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { connectFakeExtension, pairFakeExtension, type FakeExtension } from './fixtures/fakeExtension'
import { openSettings } from './fixtures/settingsNav'
import { activePanel, workflowRow } from './fixtures/canvas'
import { clickCanvasNode } from './fixtures/canvasNode'
import { nonSeededBoardObjects } from './fixtures/atlasBoard'
import { SEEDED, runSeededWorkflow, approveTheParkedRun } from './fixtures/browserReplay'

// The browser-replay step end to end (goal 0350 S2): import a recording
// into the seeded example, bind a parameter to it, run it in a paired
// browser, and read the text it brought back. Then take the browser
// away and see the run say so.
//
// Dedicated server: it pairs a browser and edits a SEEDED workflow,
// both global app state (testing.md's shared-vs-dedicated rule).
//
// The browser half is the stand-in speaking the real wire protocol
// (fixtures/fakeExtension.ts) -- see that file for why. runSeededWorkflow/
// approveTheParkedRun live in fixtures/browserReplay.ts (testing.md:
// browser-extension-mv3.spec.ts needs the same two steps against a real
// extension).

const TYPED = 'hello from Mill'

// Pairing, an import, an edit and two guarded runs in one test: the
// default budget is what this spec exceeds, not any single wait.
test.setTimeout(240_000)

// The recording the test imports: the shape a real export carries,
// against the page Mill serves itself. Its address is deliberately one
// nothing answers, so a passing run proves the bound parameter replaced
// it rather than the recording having been right all along.
const RECORDING = {
  title: 'E2E echo',
  steps: [
    { type: 'navigate', url: 'https://example.invalid/never-visited' },
    { type: 'change', value: 'not this text', selectors: [['#mill-bridge-input']] },
    { type: 'keyDown', key: 'Tab', selectors: [['#mill-bridge-input']] },
    { type: 'click', selectors: [['#mill-bridge-button']] },
    { type: 'waitForElement', selectors: [['#mill-bridge-echo']], timeout: 5000 },
  ],
}

// eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
test('a recorded flow becomes a step: import it, bind a parameter, replay it, read the text back', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-replay-${idx}-`))
  const port = BROWSER_REPLAY_SERVER_BASE_PORT + idx
  const bridgePort = port + BRIDGE_PORT_OFFSET
  const bridgeURL = `http://127.0.0.1:${bridgePort}`
  const testPageURL = `${bridgeURL}/__mill/bridge/test-page`

  let server: SpawnedServer | undefined
  let extension: FakeExtension | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({
      port,
      mcpPort: BROWSER_REPLAY_MCP_BASE_PORT + idx,
      bridgePort,
      settingsPath: path.join(dir, 'settings.json'),
      executionDbPath: path.join(dir, 'execution.db'),
      backupDir: path.join(dir, 'backups'),
      // Step 7 below stops the extension and reruns the workflow to see
      // the "no browser" failure -- production waits a full
      // browserbridge.ConnectWaitSeconds (45s) for a reconnect first;
      // this spec shortens that wait so the assertion doesn't pay it.
      extraEnv: { MILL_BRIDGE_CONNECT_WAIT_MS: '2000' },
    })
    const page = await browser.newPage()
    await applyCpuThrottle(page)
    await page.goto(`${server.baseURL}/`)

    // 1. Pair a browser and let it hold its stream open.
    await openSettings(page, 'connections')
    await page.getByTestId('pair-a-browser').click()
    const code = (await page.getByTestId('browser-pairing-code').innerText()).trim()
    const token = await pairFakeExtension(bridgeURL, code, 'Chrome')
    const replayPage = await browser.newPage()
    await applyCpuThrottle(replayPage)
    extension = connectFakeExtension(bridgeURL, token, replayPage)
    await extension.ready

    // The extension is a real folder a browser could be pointed at, not
    // a sentence about a source tree.
    await page.getByTestId('reveal-extension-folder').click()
    await expect(page.getByTestId('extension-folder-path')).toContainText('browser-extension')

    // 2. Open the seeded example's browser step. A seeded workflow opens
    //    read-only, so every control below is inert until it is switched
    //    into editing.
    await page.getByRole('link', { name: 'Workflows' }).click()
    const row = workflowRow(page, SEEDED)
    await expect(row).toBeVisible()
    await row.click()
    const panel = activePanel(page)
    await panel.getByTestId('edit-workflow').click()
    await clickCanvasNode(page, panel, 'Replay in the browser')

    const editor = panel.getByTestId('composition-inspector').getByTestId('browser-replay-editor')
    await expect(editor).toBeVisible()
    // 5 steps: the seed's own recording now ends with a click on the
    // test page's download link (goal 0350 S3), landed as a board
    // object by the workflow's own next step.
    await expect(editor.getByTestId('browser-replay-recording-summary')).toContainText('5 steps')

    // 3. Import a recording. The step describes what it read back, and
    //    the pickers below now list that recording's own steps.
    const recordingPath = path.join(dir, 'recording.json')
    writeFileSync(recordingPath, JSON.stringify(RECORDING))
    await editor.getByTestId('browser-replay-import-input').setInputFiles(recordingPath)
    await expect(editor.getByTestId('browser-replay-recording-summary'))
      .toContainText('5 steps · starts at https://example.invalid/never-visited')

    // 4. Add a parameter over the imported recording: the key its third
    //    step presses. Choosing the step picks that step's own field.
    await editor.getByTestId('browser-replay-add-parameter').click()
    await editor.locator('[data-testid="browser-replay-parameter-name"]').last().fill('submitKey')
    await editor.locator('[data-testid="browser-replay-parameter-step"]').last().selectOption('2')
    await expect(editor.locator('[data-testid="browser-replay-parameter-field"]').last()).toHaveValue('key')
    await editor.locator('[data-testid="browser-replay-parameter-literal"]').last().fill('Enter')

    // The wait moved when the recording changed; point the extraction at
    // where it is now.
    await editor.getByTestId('browser-replay-extract-step').selectOption('4')
    await panel.getByTestId('save-workflow').click()

    // 5. Run it against this server's own bridge address. Driving a live
    //    site is an external effect, so it parks for approval.
    await runSeededWorkflow(page, testPageURL, TYPED)
    await approveTheParkedRun(page)

    // 6. The browser really replayed it, against the bound address, and
    //    the text the page echoed came back under the extraction's name.
    const replayed = extension
    await expect.poll(() => replayed.received.filter((c) => c.kind === 'replay').length, { timeout: 60_000 }).toBe(1)
    const replays = replayed.received.filter((c) => c.kind === 'replay')
    expect(replays[0].flow?.steps[0].url).toEqual(testPageURL)
    expect(replays[0].flow?.steps[1].value).toEqual(TYPED)
    expect(replays[0].flow?.steps[2].key).toEqual('Enter')

    // The text the page echoed came back under the extraction's own
    // name, in the step's own result.
    await expect(page.getByTestId('run-detail')).toContainText('echoed', { timeout: 60_000 })

    // 7. With the browser gone, the run says the one thing the reader
    //    can act on.
    extension.stop()
    extension = undefined
    await runSeededWorkflow(page, testPageURL, TYPED)
    await approveTheParkedRun(page)
    await expect(page.getByTestId('run-detail'))
      .toContainText('No browser is connected. Open the Mill extension in your browser and run again.', { timeout: 60_000 })
  } finally {
    extension?.stop()
    await browser.close()
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

// The download half end to end (goal 0350 S3): the seed's OWN built-in
// recording now ends by clicking the test page's download link, so
// this test never imports a custom one -- it drives the workflow's own
// default steps, in a paired browser, through the SAME stubbed wire
// protocol (fakeExtension.ts's downloadFrom, which fetches the clicked
// `<a download>`'s own address exactly like the real extension's own
// download sink does, see that file for why a real unpacked extension
// isn't in the suite's Chromium). What's proven here is the wire being
// consumed correctly end to end (a board object lands, a second run
// matches it); the exact checksum/dedupe logic is proven directly by
// atlassvc's own Go tests.
//
// Reuses this file's own dedicated server/port pair: Playwright never
// runs two tests from one file concurrently on the same worker, so a
// second test spawning its own server on the identical ports is safe
// sequenced after the first's has already stopped.
test.setTimeout(240_000)

// eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
test('a browser-replay download lands as a board object, checksum-matched on a second run', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-replay-download-${idx}-`))
  const port = BROWSER_REPLAY_SERVER_BASE_PORT + idx
  const bridgePort = port + BRIDGE_PORT_OFFSET
  const bridgeURL = `http://127.0.0.1:${bridgePort}`
  const testPageURL = `${bridgeURL}/__mill/bridge/test-page`

  let server: SpawnedServer | undefined
  let extension: FakeExtension | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({
      port,
      mcpPort: BROWSER_REPLAY_MCP_BASE_PORT + idx,
      bridgePort,
      settingsPath: path.join(dir, 'settings.json'),
      executionDbPath: path.join(dir, 'execution.db'),
      backupDir: path.join(dir, 'backups'),
    })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)

    await openSettings(page, 'connections')
    await page.getByTestId('pair-a-browser').click()
    const code = (await page.getByTestId('browser-pairing-code').innerText()).trim()
    const token = await pairFakeExtension(bridgeURL, code, 'Chrome')
    const replayPage = await browser.newPage()
    extension = connectFakeExtension(bridgeURL, token, replayPage)
    await extension.ready

    // 1. Run the seed's own recording -- unedited, so its own download
    //    step runs -- and approve the park.
    await runSeededWorkflow(page, testPageURL, TYPED)
    await approveTheParkedRun(page)
    const fileObjectStep = await expandFileObjectStepOutput(page)
    await expect(fileObjectStep).toContainText('mill-bridge-test.pdf', { timeout: 60_000 })
    await expect(fileObjectStep).not.toContainText('Too large to keep with the run')

    // 2. The download landed as a board object at the true top level
    //    (apply-atlas-file-object never nests under "The engagement",
    //    matching apply-atlas-card-create's own root-level placement) --
    //    reached via the breadcrumb's own root crumb, same door
    //    atlas-session-restore.spec.ts uses to leave the auto-entered
    //    space.
    await gotoAtlasRoot(page)
    await expect(nonSeededBoardObjects(page, 'pdf')).toHaveCount(1)

    // 3. Running it again brings back the exact same file -- matched by
    //    content, not landed a second time -- and the run says when it
    //    first landed.
    await runSeededWorkflow(page, testPageURL, TYPED)
    await approveTheParkedRun(page)
    await expect(await expandFileObjectStepOutput(page)).toContainText('Already on the board since run', { timeout: 60_000 })

    await gotoAtlasRoot(page)
    await expect(nonSeededBoardObjects(page, 'pdf')).toHaveCount(1)
  } finally {
    extension?.stop()
    await browser.close()
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

// Leaves the auto-entered "The engagement" for the true top level ("All
// spaces"), where a root-level (ParentID=="") object actually lives.
// The egocentric-root auto-entry (ADR-0038) can re-claim the landing on
// a FRESH mount before this click's own suppressAutoEntry state has
// taken effect (atlas-session-restore.spec.ts's own persisted-session
// race) -- retried rather than a fixed wait, since the real signal is
// the breadcrumb itself, not a guessed settle time.
async function gotoAtlasRoot(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(async () => {
    await page.getByTestId('atlas-breadcrumb-root').click()
    await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('The engagement')
  }).toPass({ timeout: 15_000 })
}

// The "Land downloads on the board" step's own output, expanded: its
// JSON tree renders the downloads array's own entries collapsed by
// default (OutputViewer.tsx), so a download's filename/note is only in
// the DOM text once "Expand all" has run.
function fileObjectStepOutput(page: Page): Locator {
  const step = page.getByTestId('run-step').filter({ hasText: 'Land downloads on the board' })
  return step.getByTestId('run-step-output')
}

async function expandFileObjectStepOutput(page: Page): Promise<Locator> {
  const output = fileObjectStepOutput(page)
  // The run resumes asynchronously after approval; this step's own
  // output only renders once it has actually finished.
  await expect(output).toBeVisible({ timeout: 60_000 })
  await output.getByTestId('output-expand-all').click()
  return output
}
