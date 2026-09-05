import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from '@playwright/test'
import {
  ATLAS_IMAGE_EXPORT_HOST_COPY_MCP_BASE_PORT,
  ATLAS_IMAGE_EXPORT_HOST_COPY_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { groupCard, noteCard } from './fixtures/atlasBoard'
import { withClipboardLock } from './fixtures/clipboardLock'
import { hostClipboardAvailable } from './fixtures/hostClipboard'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { paletteDialog } from './fixtures/palette'
import { waitForViewportStable } from './fixtures/animation'
import { ATLAS_KIND_DOCUMENT } from './fixtures/kindPicker'

// "Copy as image" (docs/goals/0201): a picture of the current selection
// lands on the DESKTOP's clipboard in server mode.
//
// Split into its own dedicated-server file (goal 0356): the standard
// per-worker pool (atlas-image-export.spec.ts's other tests) defaults
// to the in-memory clipboard adapter, whose WritePNG always succeeds
// regardless of platform -- this test's own contract is that the copy
// FAILS honestly where there is no real pasteboard at all (headless
// Linux CI), which only the real Host adapter's osascript dependency
// can prove. This file spawns its own server with MILL_CLIPBOARD=host.
const CREATE_CARD = 'github.com/alicoding/mill/internal/services/atlassvc.AtlasService.CreateCard'
const DELETE_CARD = 'github.com/alicoding/mill/internal/services/atlassvc.AtlasService.DeleteCard'

async function createCard(page: Page, title: string, parentID: string, position: { X: number; Y: number } | null, viewMode = '') {
  const card = await callBindingViaRPC<{ ID: string }>(page, CREATE_CARD, [
    ATLAS_KIND_DOCUMENT, title, '', null, parentID, position, viewMode, '', '', '',
  ])
  return card.ID
}

// A space of this spec's own, holding only the named cards -- built
// through the same bound call the board's own create flow ends in,
// since the gesture version cannot promise WHERE on a seeded board a
// card lands. Returns what to delete afterwards.
async function buildSpace(page: Page, spaceTitle: string, cardTitles: string[]) {
  await page.goto('/')
  // 'canvas' explicitly: a fresh container's own default view mode is
  // shelves, and this spec is about the BOARD.
  const spaceID = await createCard(page, spaceTitle, '', null, 'canvas')
  const cardIDs: string[] = []
  for (const [index, title] of cardTitles.entries()) {
    cardIDs.push(await createCard(page, title, spaceID, { X: 80 + index * 460, Y: 100 }))
  }

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await page.getByTestId('atlas-breadcrumb').getByText('All spaces', { exact: true }).click()
  await groupCard(page, spaceTitle).getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText(spaceTitle)
  for (const title of cardTitles) await expect(noteCard(page, title)).toBeVisible()
  // Every click and every size assertion below reads live geometry, and
  // the drill-in pan is a d3-zoom interpolation, not a CSS transition.
  await waitForViewportStable(board, 20_000)
  return { spaceID, cardIDs, board }
}

async function tearDownSpace(page: Page, spaceID: string, cardIDs: string[]) {
  for (const id of cardIDs) await callBindingViaRPC(page, DELETE_CARD, [id])
  await callBindingViaRPC(page, DELETE_CARD, [spaceID])
}

// The palette door: both commands act on the board's live selection,
// which the palette itself never supplies, so this is the ordinary
// user path for driving them without a multi-selection menu open.
async function runViaPalette(page: Page, label: string) {
  await page.keyboard.press('Meta+/')
  const palette = paletteDialog(page)
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox').fill(label)
  await palette.getByRole('option', { name: label, exact: true }).click()
  await expect(palette).toHaveCount(0)
}

// eslint-disable-next-line no-empty-pattern -- needs `testInfo`, not any fixture.
test('copying says what landed on the clipboard, and whose clipboard it was', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-atlas-image-export-host-copy-${idx}-`))
  const server: SpawnedServer = await spawnMillServer({
    port: ATLAS_IMAGE_EXPORT_HOST_COPY_SERVER_BASE_PORT + idx,
    mcpPort: ATLAS_IMAGE_EXPORT_HOST_COPY_MCP_BASE_PORT + idx,
    settingsPath: path.join(dir, 'settings.json'),
    executionDbPath: path.join(dir, 'execution.db'),
    backupDir: path.join(dir, 'backups'),
    extraEnv: { MILL_CLIPBOARD: 'host' },
  })
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ baseURL: server.baseURL })
    const page = await context.newPage()
    await page.goto(`${server.baseURL}/`)
    await withClipboardLock(async () => {
      const { spaceID, cardIDs } = await buildSpace(page, 'ZzImgCopySpace', ['ZzImgCopyCard'])

      await noteCard(page, 'ZzImgCopyCard').click()
      await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)

      await runViaPalette(page, 'Copy as image')

      // This suite runs in server mode, where the picture reaches the
      // DESKTOP's clipboard: the notice says so rather than leaving it
      // to be discovered by a paste that produces nothing. Where there is
      // no real pasteboard at all (the Linux CI runner, same constraint
      // hostClipboardAvailable already names for every other clipboard
      // spec), the other half of the contract is what's provable: the
      // host's refusal reaches the same pill as a sentence, never a
      // silent no-op.
      await expect(page.getByTestId('notice-text')).toHaveText(
        hostClipboardAvailable
          ? "Copied the selection as PNG to the desktop's clipboard. This device's clipboard is unchanged."
          : "Mill couldn't put the image on the clipboard.",
        { timeout: 15_000 },
      )

      await tearDownSpace(page, spaceID, cardIDs)
    })
  } finally {
    await browser.close()
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
