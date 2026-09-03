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
import { ATLAS_KIND_TOPIC, selectKind } from './fixtures/kindPicker'
import { armAndPlaceTopicCard, clickBreadcrumbSegment, groupCard, noteCard } from './fixtures/atlasBoard'
import { createBoardObjectViaRPC, ATLAS_DEFAULT_SPACE_ID } from './fixtures/atlasNativeDropEscapeHatch'
import { waitForViewportStable } from './fixtures/animation'

// Split from atlas-select-group.spec.ts at the 500-line convention;
// same dedicated-server isolation reasoning as that file's header
// (select-then-group flows interfere on a shared worker). Port
// offsets stay inside the select-group family's own base range,
// +40 to clear its per-worker indices.

async function zoomOutLight(page: import('@playwright/test').Page): Promise<void> {
  const zoomOut = page.locator('.react-flow__controls-zoomout')
  for (let i = 0; i < 3; i++) await zoomOut.click()
  await waitForViewportStable(page.getByTestId('atlas-board'))
}

test.setTimeout(180_000)

// Board objects are Group peers (goal 0266's peer law, reversing the
// tray's recorded objects-never-file decision): a card + an object
// group into a frame whose preview draws the object's real face; a
// selection of ONLY objects groups too, and the resulting card
// renders as a frame purely via its object children (the frame-role
// law). Dedicated server, same isolation reasoning as this file's
// header.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('grouping reaches board objects: mixed and object-only selections form frames; the preview shows the object (goal 0266)', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-atlas-object-group-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = ATLAS_SELECT_GROUP_SERVER_BASE_PORT + 40 + idx
  const mcpPort = ATLAS_SELECT_GROUP_MCP_BASE_PORT + 40 + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({ port, mcpPort, settingsPath, executionDbPath, backupDir })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Atlas' }).click()
    const board = page.getByTestId('atlas-board')
    await expect(board).toBeVisible()
    await zoomOutLight(page)

    const popover = page.getByTestId('atlas-placement-popover')
    await armAndPlaceTopicCard(page, board, popover, 0.25, 0.05, 'ZzObjGroupCard')

    // Broken mirror paths are fine: the face renders its honest
    // error state and the node still selects/groups like any object.
    await createBoardObjectViaRPC(page, 'image', { title: 'ZzObjA', mirrorPath: '/nonexistent/zz-a.png' }, { X: 60, Y: 420 }, ATLAS_DEFAULT_SPACE_ID)
    await createBoardObjectViaRPC(page, 'image', { title: 'ZzObjB', mirrorPath: '/nonexistent/zz-b.png' }, { X: 320, Y: 420 }, ATLAS_DEFAULT_SPACE_ID)
    await page.reload()
    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(board).toBeVisible()

    const cardA = noteCard(page, 'ZzObjGroupCard')
    // Non-seeded, non-preview: the seeded Board gallery's own filed
    // objects render as preview tiles at this level (0266's preview
    // law working), so both filters are load-bearing.
    const looseImages = page
      .locator('.react-flow__node:not([data-id^="atlas-object-example-"])')
      .filter({ has: page.locator('[data-testid="atlas-board-object"][data-object-kind="image"]') })
    const previews = page.locator('[data-testid="atlas-board-object-preview"]')
    await expect(cardA).toBeVisible()
    await expect(looseImages).toHaveCount(2)
    const previewsBefore = await previews.count()
    const selected = page.locator('.react-flow__node.selected')

    // Mixed selection: card + one object -> G -> frame.
    await cardA.click({ modifiers: ['Shift'] })
    await looseImages.first().click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(2)
    await expect(page.getByTestId('atlas-selection-count')).toHaveText('2 selected')
    // The tray's Group button shows for a mixed selection too (the
    // render gate was still cards-only after the keyboard gate widened
    // -- caught in the screenshot review).
    await expect(page.getByTestId('atlas-selection-group')).toBeVisible()
    await page.keyboard.press('g')
    await expect(popover).toBeVisible()
    await expect(page.getByTestId('atlas-placement-context')).toContainText('2 items')
    await selectKind(popover, ATLAS_KIND_TOPIC)
    await popover.getByTestId('atlas-placement-title').fill('ZzObjMixedArea')
    await popover.getByTestId('atlas-placement-submit').click()
    await expect(popover).not.toBeVisible()
    const mixedArea = groupCard(page, 'ZzObjMixedArea')
    await expect(mixedArea).toBeVisible()
    await expect(mixedArea.getByTestId('atlas-group-header')).toContainText('2 items')

    // The filed object's real face previews inside the frame, inert
    // (one MORE preview tile than the seeded gallery already showed).
    await expect(previews).toHaveCount(previewsBefore + 1)
    await expect(looseImages).toHaveCount(1)

    // Drill in: the object renders full-size (not a preview tile) at
    // its own level beside the card.
    await mixedArea.getByTestId('atlas-group-header').click()
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('ZzObjMixedArea')
    await expect(previews).toHaveCount(0)
    await expect(looseImages).toHaveCount(1)
    await expect(noteCard(page, 'ZzObjGroupCard')).toBeVisible()

    // Back to the root level for the object-only half.
    await clickBreadcrumbSegment(page, page.getByTestId('atlas-breadcrumb').getByText('The engagement', { exact: true }), 'The engagement')
    await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('ZzObjMixedArea')

    // Object-only selection: the remaining loose object + nothing else
    // can't group alone (gate needs 2) -- create is proven by the
    // mixed flow; here the REVERSAL proof: select the loose object +
    // the mixed frame? No -- keep it object-only: land one more.
    await createBoardObjectViaRPC(page, 'image', { title: 'ZzObjC', mirrorPath: '/nonexistent/zz-c.png' }, { X: 320, Y: 700 }, ATLAS_DEFAULT_SPACE_ID)
    await page.reload()
    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(board).toBeVisible()
    await expect(looseImages).toHaveCount(2)
    await looseImages.nth(0).click({ modifiers: ['Shift'] })
    await looseImages.nth(1).click({ modifiers: ['Shift'] })
    await expect(selected).toHaveCount(2)
    await page.keyboard.press('g')
    await expect(popover).toBeVisible()
    await selectKind(popover, ATLAS_KIND_TOPIC)
    await popover.getByTestId('atlas-placement-title').fill('ZzObjOnlyArea')
    await popover.getByTestId('atlas-placement-submit').click()
    await expect(popover).not.toBeVisible()

    // The frame-role law's own proof: a card whose ONLY children are
    // board objects renders as a region frame.
    const objectOnlyArea = groupCard(page, 'ZzObjOnlyArea')
    await expect(objectOnlyArea).toBeVisible()
    await expect(objectOnlyArea.getByTestId('atlas-group-header')).toContainText('2 items')
  } finally {
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
