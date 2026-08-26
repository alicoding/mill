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
import { armAndPlaceTopicCard, noteCard } from './fixtures/atlasBoard'
import { waitForViewportStable } from './fixtures/animation'

// Split out of atlas-select-group.spec.ts at the 500-line convention
// (CLAUDE.md) -- this test is fully self-contained (its own server spawn/
// teardown) and shares no state with that file's own select-then-group
// flows, so the split needed no shared plumbing beyond the same +60
// port range (still isolated per-worker via testInfo.parallelIndex).

// A LIGHTER zoom-out than fixtures/atlasBoard.ts's own zoomAllTheWayOut
// (8 clicks) -- duplicated from atlas-select-group.spec.ts's own copy,
// matching this suite's existing per-spec-file convention for small
// local helpers.
async function zoomOutLight(page: import('@playwright/test').Page): Promise<void> {
  const zoomOut = page.locator('.react-flow__controls-zoomout')
  for (let i = 0; i < 3; i++) await zoomOut.click()
  await waitForViewportStable(page.getByTestId('atlas-board'))
}

// atlas.selectAll's own ⌘A (shared/atlasBoardCommands.ts, app/useKeymapDispatch.ts's
// Listener 5): a dedicated, editable-target-guarded listener, not the
// generic dispatcher -- proves both halves in one flow, native
// select-all-text inside the jump dialog's own input stays untouched,
// and a real board-level press selects every card.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('atlas select-all (Cmd+A): guarded inside an editable field, selects every card on the board otherwise', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-atlas-select-all-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = ATLAS_SELECT_GROUP_SERVER_BASE_PORT + idx
  const mcpPort = ATLAS_SELECT_GROUP_MCP_BASE_PORT + idx

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
    await armAndPlaceTopicCard(page, board, popover, 0.25, 0.05, 'ZzA2eSelAllA')
    await armAndPlaceTopicCard(page, board, popover, 0.55, 0.05, 'ZzA2eSelAllB')

    const selected = page.locator('.react-flow__node.selected')

    // Editable-target guard: Cmd+A inside the jump dialog's own search
    // input is native browser select-all-text, never board select-all.
    await page.keyboard.press('Meta+k')
    const jumpInput = page.getByTestId('atlas-jump-input')
    await expect(jumpInput).toBeFocused()
    await jumpInput.press('Meta+a')
    await expect(selected).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Real dispatch: Cmd+A on the board selects EVERY top-level card AND
    // board object at this level (useAtlasSelectAll.ts) -- the seeded
    // root ("The engagement") carries 4 cards (Client records, Discovery
    // workstream, Scratchpad, Board gallery -- the last nests goal
    // 0223's own seeded board objects rather than rendering them at
    // root) and 0 board objects of its own, plus the 2 cards just
    // placed.
    await page.keyboard.press('Meta+a')
    await expect(selected).toHaveCount(6)
    const selectionTray = page.getByTestId('atlas-selection-tray')
    await expect(selectionTray).toBeVisible()
    await expect(page.getByTestId('atlas-selection-count')).toHaveText('6 selected')

    // Cleanup: quick delete + clock-controlled toast expiry. Select-all
    // includes seeded frames whose unselected children would be
    // promoted, so this passes the container-delete gate (goal 0149).
    await page.clock.install()
    await page.keyboard.press('Delete')
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(noteCard(page, 'ZzA2eSelAllA')).toHaveCount(0)
    await expect(noteCard(page, 'ZzA2eSelAllB')).toHaveCount(0)
    const undoToast = page.getByTestId('atlas-undo-toast')
    await expect(undoToast).toBeVisible()
    await page.clock.fastForward('00:11')
    await expect(undoToast).toHaveCount(0)
  } finally {
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
