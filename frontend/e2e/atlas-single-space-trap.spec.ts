import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ATLAS_SINGLE_SPACE_MCP_BASE_PORT,
  ATLAS_SINGLE_SPACE_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { contextMenu } from './fixtures/contextMenu'
import { groupCard, noteCard, zoomAllTheWayOut } from './fixtures/atlasBoard'

// Own dedicated server (docs/goals/0183): this spec deletes the seeded
// root card down to ZERO spaces and back, a global root-card-count
// state every other Atlas spec in the shared pool assumes never
// happens -- they all rely on auto-entering the one seeded root ("The
// engagement") on every fresh load, same own-server-own-ports
// reasoning as atlas-session-restore.spec.ts.
//
// Regression this pins: with exactly one root card, navigating up
// (⌘↑) used to silently refuse (useAtlasNavSignals.ts), and the sole
// space had no in-place rename/delete door -- together, the sole space
// could never become an object you could act on without first creating
// a throwaway sibling. Goal 0221 removed the ADDITIONAL gap this test
// used to pin alongside it: the "All spaces" crumb (AtlasBreadcrumb.tsx)
// now renders unconditionally, even while auto-entered into a lone
// root card, rather than staying hidden until a deliberate up-nav.

test.setTimeout(180_000)

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('with exactly one space, navigating up reaches "All spaces" and the space is deletable from inside it -- down to a coherent empty board', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-atlas-single-space-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = ATLAS_SINGLE_SPACE_SERVER_BASE_PORT + idx
  const mcpPort = ATLAS_SINGLE_SPACE_MCP_BASE_PORT + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({ port, mcpPort, settingsPath, executionDbPath, backupDir })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Atlas' }).click()
    const board = page.getByTestId('atlas-board')
    await expect(board).toBeVisible()
    const menu = contextMenu(page)
    // Every fixed-pixel pane right-click below targets (12, 12): reliably
    // empty background only once content is pushed toward the board's
    // own center, same convention fixtures/atlasBoard.ts's own callers
    // use everywhere else -- card count keeps shrinking as this test
    // deletes its way to zero, so this is re-run after every landing in
    // a differently-populated space, not just once up front.
    await zoomAllTheWayOut(page)

    // Egocentric-root auto-entry still lands directly inside the sole
    // space on load (ADR-0038's intent, unregressed) -- but the "All
    // spaces" crumb is visible right away too (goal 0221): one click
    // out is always available, never gated on root-card count.
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('The engagement')
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('All spaces')

    // Part A: navigating up from the single root is now permitted --
    // before the fix this was a silent no-op (useAtlasNavSignals.ts's
    // own refusal). No overlay ever opens as a side effect of this
    // navigation (goal 0221's "no navigation control ends in an
    // overlay" contract).
    await page.keyboard.press('Meta+ArrowUp')
    await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('The engagement')
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('All spaces')
    await expect(page.locator('[data-component="atlas-card-overlay"]')).not.toBeVisible()
    // The sole space is now a real object on the board -- reachable,
    // right-clickable, deletable through its own ordinary card menu
    // (unaffected by this goal, already covered elsewhere).
    const engagement = groupCard(page, 'The engagement')
    await expect(engagement).toBeVisible()

    // Re-enter it: the meta crumb stays visible, now selected on "The
    // engagement" instead of the meta level.
    await engagement.getByTestId('atlas-group-header').click()
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('The engagement')
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('All spaces')

    // Part B: the space is actionable from INSIDE it too, without
    // first navigating up -- its own empty-board right-click menu now
    // carries Rename/Delete, reusing the card's own existing page
    // overlay (rename) and the same guarded delete door every other
    // Atlas card delete already goes through.
    await board.click({ button: 'right', position: { x: 12, y: 12 } })
    await expect(menu).toBeVisible()
    await expect(menu.getByText('Rename space…', { exact: true })).toBeVisible()
    await expect(menu.getByText('Delete space', { exact: true })).toBeVisible()

    await menu.getByText('Rename space…', { exact: true }).click()
    const overlay = page.locator('[data-component="atlas-card-overlay"]')
    await expect(overlay).toBeVisible()
    await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('The engagement')
    await page.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()

    // Deleting the space it's viewed from: "The engagement" holds 3
    // children (Client records/Discovery workstream/Scratchpad), so
    // the container-delete gate (goal 0149 gap 3) confirms first,
    // naming the promoted count -- same guarded door as every other
    // container delete, reached from a NEW trigger point.
    await board.click({ button: 'right', position: { x: 12, y: 12 } })
    await expect(menu).toBeVisible()
    await menu.getByText('Delete space', { exact: true }).click()
    await expect(page.getByText('3 items inside move up a level. You can undo right after.')).toBeVisible()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()

    // Lands on "All spaces" -- not a dead end -- showing what remains:
    // "The engagement"'s 3 direct children, promoted to root cards.
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('All spaces')
    await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('The engagement')
    await expect(groupCard(page, 'Client records')).toBeVisible()
    await expect(noteCard(page, 'Discovery workstream')).toBeVisible()
    await expect(noteCard(page, 'Scratchpad')).toBeVisible()

    // Drain two of the three promoted leaves -- ordinary,
    // already-covered-elsewhere instant leaf deletes.
    for (const title of ['Discovery workstream', 'Scratchpad']) {
      await noteCard(page, title).click({ button: 'right' })
      await expect(menu).toBeVisible()
      await menu.getByText('Delete', { exact: true }).click()
      await expect(noteCard(page, title)).toHaveCount(0)
    }

    // "Client records" is now the SOLE remaining root: egocentric-root
    // auto-entry (unregressed by this goal, since nothing here marked
    // suppressAutoEntry -- this landing was never a deliberate up-nav)
    // drills straight into it, exactly the "convenience" behaviour
    // atlas.spec.ts's own sibling-deleted-back-to-one test already
    // pins. It is itself now a root-level space, so the SAME
    // rename/delete door applies recursively.
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('All spaces')
    await zoomAllTheWayOut(page)
    await board.click({ button: 'right', position: { x: 12, y: 12 } })
    await expect(menu).toBeVisible()
    await expect(menu.getByText('Delete space', { exact: true })).toBeVisible()
    await menu.getByText('Delete space', { exact: true }).click()
    await expect(page.getByText('2 items inside move up a level. You can undo right after.')).toBeVisible()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()

    // Two roots left (Jordan Reyes, Statement of work) -- auto-entry
    // stays parked at "All spaces" until exactly one remains again.
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('All spaces')
    await noteCard(page, 'Jordan Reyes').click({ button: 'right' })
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
    await expect(noteCard(page, 'Jordan Reyes')).toHaveCount(0)

    // "Statement of work" is now the sole remaining root, auto-entered
    // into exactly like "The engagement" was at the very top of this
    // test -- and exactly like the reported "d" repro (auto-entered
    // into a space with nothing else inside it). Deleting it from
    // inside is the SAME door, gated purely on "this board's own card
    // is a root", not on its content -- no children here means an
    // instant, no-confirm delete (goal 0093's guard).
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Statement of work')
    await zoomAllTheWayOut(page)
    await board.click({ button: 'right', position: { x: 12, y: 12 } })
    await expect(menu).toBeVisible()
    await menu.getByText('Delete space', { exact: true }).click()

    // Zero spaces left: a coherent empty state, not a dead end --
    // still "All spaces", still actionable (Add card here recreates a
    // space), never a blank or stuck screen.
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('All spaces')
    await expect(page.getByTestId('atlas-empty-space')).toBeVisible()
    await board.click({ button: 'right', position: { x: 12, y: 12 } })
    await expect(menu).toBeVisible()
    await expect(menu.getByText('Add card', { exact: true })).toBeVisible()
  } finally {
    await server?.stop()
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
