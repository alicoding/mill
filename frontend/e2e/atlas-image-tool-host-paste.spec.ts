import { chromium, expect, test } from '@playwright/test'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ATLAS_IMAGE_TOOL_HOST_PASTE_MCP_BASE_PORT,
  ATLAS_IMAGE_TOOL_HOST_PASTE_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { nonSeededBoardObjects } from './fixtures/atlasBoard'
import { withClipboardLock } from './fixtures/clipboardLock'

// A minimal valid 1x1 PNG, inlined rather than read from disk -- the
// paste path never touches the filesystem until SaveImageBytes writes
// it server-side, so the test only needs real bytes of the right type.
const ONE_PIXEL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function imageObjects(page: import('@playwright/test').Page) {
  return nonSeededBoardObjects(page, 'image')
}

// Regression (goal 0255): board-level ⌘V of a screenshot bitmap was an
// explicit no-op -- the window paste door returned on ANY files
// payload, recorded at the time as "real paths unreachable via the web
// Clipboard API". The door now asks the HOST pasteboard for real file
// paths first (Finder ⌘C gets full drop parity) and falls back to the
// bitmap's own bytes through the image tool's commit door. This test
// drives the bitmap fallback with NO popover open anywhere: the real
// pasteboard is first given plain text (lock held -- the host
// path-read touches the one real macOS pasteboard) so that read
// honestly answers empty, then a files-carrying paste is dispatched at
// the window.
//
// Split into its own dedicated-server file (goal 0356): the standard
// per-worker pool (atlas-image-tool.spec.ts's other tests) defaults to
// the in-memory clipboard adapter, which would make the host file-url
// read trivially empty for the wrong reason (nothing ever populates
// it) rather than proving the real pasteboard path -- this file spawns
// its own server with MILL_CLIPBOARD=host instead.
// eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
test('pasting a screenshot bitmap directly on the board lands an image object', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-atlas-image-tool-host-paste-${idx}-`))
  const server: SpawnedServer = await spawnMillServer({
    port: ATLAS_IMAGE_TOOL_HOST_PASTE_SERVER_BASE_PORT + idx,
    mcpPort: ATLAS_IMAGE_TOOL_HOST_PASTE_MCP_BASE_PORT + idx,
    settingsPath: path.join(dir, 'settings.json'),
    executionDbPath: path.join(dir, 'execution.db'),
    backupDir: path.join(dir, 'backups'),
    extraEnv: { MILL_CLIPBOARD: 'host' },
  })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await withClipboardLock(async () => {
      if (process.platform === 'darwin') {
        execSync('pbcopy', { input: 'goal-0255-plain-text-baseline' })
      }
      await page.goto(`${server.baseURL}/`)
      await page.getByRole('link', { name: 'Atlas' }).click()
      const board = page.getByTestId('atlas-board')
      await expect(board).toBeVisible()
      // Position gesture, not an interaction: the paste anchors at the
      // last known pointer position (atlas-paste-convert.spec.ts's own
      // convention -- nothing is clicked, so nothing needs actionability).
      const bb = await board.boundingBox()
      if (!bb) throw new Error('no board box')
      // eslint-disable-next-line no-restricted-syntax -- pure pointer positioning, no interaction to check
      await page.mouse.move(bb.x + bb.width * 0.55, bb.y + bb.height * 0.65)

      await page.evaluate((base64) => {
        const bin = atob(base64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const file = new File([bytes], 'screenshot.png', { type: 'image/png' })
        const dt = new DataTransfer()
        dt.items.add(file)
        window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      }, ONE_PIXEL_PNG_BASE64)

      const object = imageObjects(page)
      await expect(object).toHaveCount(1)
      await expect(object.locator('img')).toBeVisible()
      // Nothing became a card, and no popover was involved.
      await expect(page.getByTestId('atlas-note-card').filter({ hasText: 'Pasted image' })).toHaveCount(0)
      await expect(page.getByTestId('atlas-image-input')).toHaveCount(0)

      await object.click()
      await page.keyboard.press('Delete')
      await expect(object).toHaveCount(0)
    })
  } finally {
    await browser.close()
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
