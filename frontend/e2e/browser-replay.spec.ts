import { chromium, expect, test, type Page } from '@playwright/test'
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

// The browser-replay step end to end (goal 0350 S2): import a recording
// into the seeded example, bind a parameter to it, run it in a paired
// browser, and read the text it brought back. Then take the browser
// away and see the run say so.
//
// Dedicated server: it pairs a browser and edits a SEEDED workflow,
// both global app state (testing.md's shared-vs-dedicated rule).
//
// The browser half is the stand-in speaking the real wire protocol
// (fixtures/fakeExtension.ts) -- see that file for why.

const SEEDED = 'Example: Replay a browser flow'
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
    })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)

    // 1. Pair a browser and let it hold its stream open.
    await openSettings(page, 'connections')
    await page.getByTestId('pair-a-browser').click()
    const code = (await page.getByTestId('browser-pairing-code').innerText()).trim()
    const token = await pairFakeExtension(bridgeURL, code, 'Chrome')
    const replayPage = await browser.newPage()
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
    await expect(editor.getByTestId('browser-replay-recording-summary')).toContainText('4 steps')

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
    await runSeededWorkflow(page, testPageURL)
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
    await runSeededWorkflow(page, testPageURL)
    await approveTheParkedRun(page)
    await expect(page.getByTestId('run-detail'))
      .toContainText('No browser is connected. Pair the Mill extension first.', { timeout: 60_000 })
  } finally {
    extension?.stop()
    await browser.close()
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

// Starts the seeded workflow from the Workflows list, filling this run's
// two declared Attributes, and lands on its own Runs tab.
async function runSeededWorkflow(page: Page, pageURL: string): Promise<void> {
  await page.getByRole('link', { name: 'Workflows' }).click()
  const row = workflowRow(page, SEEDED)
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Run' }).click()

  // A workflow with declared Attributes asks for this run's values
  // before it starts.
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Page address').fill(pageURL)
  await dialog.getByLabel('Text to type').fill(TYPED)
  await dialog.getByRole('button', { name: 'Run', exact: true }).click()

  // Saving closed the editor tab, so the workflow is opened again from
  // its row to reach its own Runs tab.
  await row.click()
  await page.getByRole('tab', { name: 'Runs' }).click()
}

// Opens the newest parked run and approves its browser step.
async function approveTheParkedRun(page: Page): Promise<void> {
  await expect(page.getByTestId('run-awaiting-approval').first()).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('runs-table').locator('tbody tr').first().click()
  const banner = page.getByTestId('approval-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('Replay in the browser')
  await banner.getByTestId('approve-step').click()
  // The run resumes asynchronously; nothing downstream is true until the
  // approval banner is gone.
  await expect(page.getByTestId('approval-banner')).toHaveCount(0, { timeout: 60_000 })
}
