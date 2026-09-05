import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ATLAS_SELECT_GROUP_MCP_BASE_PORT,
  ATLAS_SELECT_GROUP_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { armAndPlaceTopicCard, groupCard, noteCard } from './fixtures/atlasBoard'
import { waitForViewportStable } from './fixtures/animation'

// Atlas copy/paste clones (docs/goals/0153 slice 2+3): ⌘C serializes
// the selection to the system clipboard, ⌘V pastes shallow clones at
// the cursor, and a single-card paste whose source holds items inside
// offers "also copy them" through the quiet toast's action. Dedicated
// server (the gesture-retry class this file's group flow shares with
// atlas-select-group.spec.ts), +60 off that spec's port range.
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test.setTimeout(180_000)

// panePoint finds a screen point whose top element is the bare canvas
// pane -- CI viewports differ from local, so fixed fractions can land
// over a frame and silently FILE the pasted clone into it (the
// openPlacementPopover fixture's own candidate pattern). Positions the
// real cursor there itself before returning -- the paste that follows
// reads wherever the cursor last moved. A pure cursor-position gesture,
// not an interaction: the paste-anchor logic reads the last window-
// level mousemove coordinate, which bubbles regardless of what's on top
// of the board at that pixel, so locator.hover()'s hit-target/stability
// check is the wrong tool here -- it made a sibling test (canvas-
// clipboard.spec.ts) newly flaky against real, legitimate chrome
// overlap (confirmed live, goal 0184 migration probe). The elementFromPoint
// probe above already does the real work this function needs (confirming
// the point is genuinely empty pane, not just "currently stable").
async function panePoint(page: import('@playwright/test').Page, board: import('@playwright/test').Locator): Promise<{ x: number; y: number }> {
  const bb = await board.boundingBox()
  if (!bb) throw new Error('board box missing')
  const fractions: [number, number][] = [[0.3, 0.6], [0.75, 0.4], [0.2, 0.4], [0.6, 0.75], [0.4, 0.85], [0.85, 0.25]]
  for (const [fx, fy] of fractions) {
    const c = { x: bb.x + bb.width * fx, y: bb.y + bb.height * fy }
    const isPane = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.classList?.contains('react-flow__pane') ?? false, [c.x, c.y])
    if (isPane) {
      // eslint-disable-next-line no-restricted-syntax -- cursor-position-only gesture, not a checkable interaction (see comment above)
      await page.mouse.move(c.x, c.y)
      return c
    }
  }
  throw new Error('no empty pane point found')
}


async function zoomOutLight(page: import('@playwright/test').Page): Promise<void> {
  const zoomOut = page.locator('.react-flow__controls-zoomout')
  for (let i = 0; i < 3; i++) await zoomOut.click()
  await waitForViewportStable(page.getByTestId('atlas-board'))
}

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('copy/paste clones a card at the cursor; a frame paste offers its items', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-atlas-clipboard-${idx}-`))
  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({
      port: ATLAS_SELECT_GROUP_SERVER_BASE_PORT + 60 + idx,
      mcpPort: ATLAS_SELECT_GROUP_MCP_BASE_PORT + 60 + idx,
      settingsPath: path.join(dir, 'settings.json'),
      executionDbPath: path.join(dir, 'execution.db'),
      backupDir: path.join(dir, 'backups'),
    })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Atlas' }).click()
    const board = page.getByTestId('atlas-board')
    await expect(board).toBeVisible()
    await zoomOutLight(page)

    const popover = page.getByTestId('atlas-placement-popover')
    const toast = page.getByTestId('atlas-quiet-toast')

    await armAndPlaceTopicCard(page, board, popover, 0.25, 0.05, 'ZzClipA')
    await armAndPlaceTopicCard(page, board, popover, 0.55, 0.05, 'ZzClipB')
    const cardA = noteCard(page, 'ZzClipA')

    // Single-card copy/paste: the clone lands where the cursor is.
    await cardA.click()
    await page.keyboard.press(`${mod}+c`)
    await expect(toast).toContainText('Copied 1 item')
    await panePoint(page, board)
    await page.keyboard.press(`${mod}+v`)
    await expect(toast).toContainText('Pasted 1 item')
    await expect(noteCard(page, 'ZzClipA')).toHaveCount(2)

    // A frame with items inside, built over the runtime wire (the
    // kind-authoring spec's Call.ByName precedent) -- group GESTURES
    // are covered elsewhere; this test is about the clipboard.
    const callBound = async (method: string, args: unknown[]) => {
      const res = await page.request.post(new URL('/wails/runtime', page.url()).toString(), {
        headers: { 'x-wails-client-id': 'e2e-clipboard', 'Content-Type': 'application/json' },
        data: { object: 0, method: 0, args: { 'call-id': `cb-${Math.random()}`, methodName: `github.com/alicoding/mill/internal/services/atlassvc.AtlasService.${method}`, args } },
      })
      const text = await res.text()
      if (!res.ok()) throw new Error(`${method} failed: ${res.status()} ${text}`)
      return JSON.parse(text)
    }
    const cards = (await callBound('Cards', [])) as { ID: string; Title: string; KindID: string }[]
    const spaceID = cards.find((c) => c.Title === 'The engagement')!.ID
    const topicKindID = cards.find((c) => c.Title === 'Discovery workstream')!.KindID
    const frameCard = await callBound('CreateCard', [topicKindID, 'ZzClipFrame', '', {}, spaceID, { X: -280, Y: 380 }, '', '', '', '']) as { ID: string }
    await callBound('CreateCard', [topicKindID, 'ZzClipKidA', '', {}, frameCard.ID, { X: 10, Y: 10 }, '', '', '', ''])
    await callBound('CreateCard', [topicKindID, 'ZzClipKidB', '', {}, frameCard.ID, { X: 210, Y: 10 }, '', '', '', ''])
    await page.reload()
    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(board).toBeVisible()
    await zoomOutLight(page)

    const frame = groupCard(page, 'ZzClipFrame')
    await expect(frame).toBeVisible()
    // First plain click = select-and-replace (goal 0102's table; a
    // SECOND click would drill). The left bottom padding strip at 92%
    // height sits below the child tiles -- clicked through the frame's
    // own locator, position derived from its own box, so the offset
    // always stays inside it regardless of zoom.
    const fb = await frame.boundingBox()
    if (!fb) throw new Error('frame box missing')
    await frame.click({ position: { x: fb.width * 0.5, y: fb.height * 0.92 } })
    // The selection must have RENDERED before ⌘C reads it.
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)
    await page.keyboard.press(`${mod}+c`)
    await expect(toast).toContainText('Copied 1 item')
    await panePoint(page, board)
    await page.keyboard.press(`${mod}+v`)
    // Shallow by default: the offer names the two items inside.
    const offer = page.getByTestId('atlas-quiet-toast-action')
    await expect(offer).toContainText('Also copy the 2 items inside') // count: fixture-owned -- the two objects this test filed into its own frame.
    await offer.click()
    await expect(toast).toContainText('Copied 2 items inside') // count: fixture-owned -- same two objects.
    const frames = groupCard(page, 'ZzClipFrame')
    await expect(frames).toHaveCount(2)
    await expect(frames.nth(1).getByTestId('atlas-group-header')).toContainText('2 items')
  } finally {
    await server?.stop()
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
