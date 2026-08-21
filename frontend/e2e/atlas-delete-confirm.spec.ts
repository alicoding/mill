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
import { contextMenu } from './fixtures/contextMenu'
import { ATLAS_KIND_TOPIC, selectKind } from './fixtures/kindPicker'
import { armAndPlaceTopicCard, groupCard, noteCard } from './fixtures/atlasBoard'
import { waitForViewportStable } from './fixtures/animation'

// Dedicated server (the guardrail-review pattern): this flow reads
// board-wide selection state and creates/deletes its own structure --
// same isolation reasoning as atlas-select-group.spec.ts, whose port
// range it shares at a +40 offset.

async function zoomOutLight(page: import('@playwright/test').Page): Promise<void> {
  const zoomOut = page.locator('.react-flow__controls-zoomout')
  for (let i = 0; i < 3; i++) await zoomOut.click()
  await waitForViewportStable(page.getByTestId('atlas-board'))
}

test.setTimeout(180_000)

// The container-delete gate (goal 0149 gap 3): deleting a frame whose
// children survive by promotion confirms first, naming the promoted
// count; leaf deletes stay instant-with-undo (asserted by the goals
// 0092/0093 test above). Dedicated server, same isolation reasoning as
// this file's header.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('deleting a frame with children confirms with the promoted count; cancel keeps it', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-atlas-del-confirm-${idx}-`))
  const port = ATLAS_SELECT_GROUP_SERVER_BASE_PORT + 40 + idx
  const mcpPort = ATLAS_SELECT_GROUP_MCP_BASE_PORT + 40 + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({
      port, mcpPort,
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
    const menu = contextMenu(page)

    await armAndPlaceTopicCard(page, board, popover, 0.25, 0.05, 'ZzK2eDelGuardA')
    await armAndPlaceTopicCard(page, board, popover, 0.55, 0.05, 'ZzK2eDelGuardB')
    const cardA = noteCard(page, 'ZzK2eDelGuardA')
    const cardB = noteCard(page, 'ZzK2eDelGuardB')

    await cardA.click({ modifiers: ['Shift'] })
    await cardB.click({ modifiers: ['Shift'] })
    await expect(async () => {
      if (await popover.isVisible()) return
      await cardA.click({ button: 'right' })
      await expect(menu).toBeVisible({ timeout: 2_000 })
      await menu.getByText('Group into new area', { exact: true }).click({ timeout: 2_000 })
      await expect(popover).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 25_000, intervals: [500] })
    await selectKind(popover, ATLAS_KIND_TOPIC)
    await popover.getByTestId('atlas-placement-title').fill('ZzK2eDelGuardArea')
    await popover.getByTestId('atlas-placement-submit').click()
    const frame = groupCard(page, 'ZzK2eDelGuardArea')
    await expect(frame).toBeVisible()

    // Delete on the frame's own menu opens the gate instead of firing.
    await frame.getByTestId('atlas-group-header').click({ button: 'right' })
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
    await expect(page.getByText('2 items inside move up a level. You can undo right after.')).toBeVisible()

    // Cancel keeps everything.
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(frame).toBeVisible()

    // Confirming deletes the frame; the children survive, promoted.
    await frame.getByTestId('atlas-group-header').click({ button: 'right' })
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(frame).toHaveCount(0)
    await expect(cardA).toBeVisible()
    await expect(cardB).toBeVisible()

    // Cleanup: a leaf selection deletes instantly, no gate.
    await page.keyboard.press('Escape')
    await cardA.click({ modifiers: ['Shift'] })
    await cardB.click({ modifiers: ['Shift'] })
    await page.keyboard.press('Delete')
    await expect(cardA).toHaveCount(0)
    await expect(cardB).toHaveCount(0)
  } finally {
    await server?.stop()
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
