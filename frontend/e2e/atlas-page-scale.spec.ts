import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MIRROR_MCP_BASE_PORT,
  MIRROR_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'

// The card PAGE at scale (goal 0073 slice B): a card holding many
// children must cap its own Contents column the same way a board
// frame already caps its preview slots (goal 0073 slice A), and
// mirror previews must stay bounded rather than fetching-and-rendering
// every child's content at once. Spawns its own server (atlas-
// scale.spec.ts's own-server pattern) because its own
// MILL_TEST_FOLDER_PICK_PATH override must never leak into the
// standard workers' seeded assertions -- own disjoint port range for
// the same reason.
//
// The fixture folder (mirror-dense/Mirror Stack/, 5 flat one-line real
// .md files) is scanned and imported in ONE recursive
// ImportFolderSuggestions call -- the same container-plus-nested-
// children mechanism atlas-page.spec.ts's own "Reports" fixture
// already exercises (containers are created before their own
// children, ordered by path depth), rather than a manual empty-card
// creation followed by a board-level drill: the board has no
// affordance to descend into a card before it holds at least one real
// child (a childless card always renders as a flippable note, never a
// region frame), so the ONLY way to land 5 real children under one
// freshly-named container is a single import that creates both in the
// same call. HumanizeFilename title-cases every word of a scanned
// name, so the resulting card reads "Mirror Stack", not the fixture
// directory's own literal case.
const MIRROR_DENSE_FIXTURE = path.resolve(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mirror-dense')

function groupCard(page: import('@playwright/test').Page, title: string) {
  return page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator(`[aria-label="Zoom into ${title}"]`) })
}

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('a card page at scale caps its entries with an honest expander and lazy-loads mirror previews past the eager few', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-mirror-${idx}-`))
  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({
      port: MIRROR_SERVER_BASE_PORT + idx,
      mcpPort: MIRROR_MCP_BASE_PORT + idx,
      settingsPath: path.join(dir, 'settings.json'),
      executionDbPath: path.join(dir, 'execution.db'),
      backupDir: path.join(dir, 'backups'),
      extraEnv: { MILL_TEST_FOLDER_PICK_PATH: MIRROR_DENSE_FIXTURE },
    })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(page.getByTestId('atlas-board')).toBeVisible()

    // "Mirror Stack" (a container, Folders group) plus its 5 nested
    // markdown files (Files group) land as one recursive import --
    // Folders first, then Files, matching the dialog's own group
    // order (containers, then files, then images).
    await page.getByTestId('atlas-add-from-folder').click()
    const dialog = page.locator('[data-component="atlas-folder-import-dialog"]')
    await expect(dialog).toBeVisible()
    const kindSelects = dialog.getByTestId('atlas-folder-import-kind')
    await kindSelects.nth(0).selectOption({ label: '🧭 Topic' })
    await kindSelects.nth(1).selectOption({ label: '📄 Document' })
    await dialog.getByRole('button', { name: 'Add 6 cards' }).click()
    await expect(dialog).not.toBeVisible()

    const mirrorStack = groupCard(page, 'Mirror Stack')
    await expect(mirrorStack).toBeVisible()

    // Open the page: a region frame's own body click flips it in
    // place, then its back face's Open leads to the same full-page
    // overlay a leaf's own flip does (atlas-page.spec.ts's own
    // established pattern for reaching a group's page). x:6 sits
    // inside the frame's left GROUP_PADDING gutter, a blank strip
    // running the frame's full height below its header -- safe
    // regardless of how many rows the 5 previewed children wrap into.
    await mirrorStack.click({ position: { x: 6, y: 60 } })
    await expect(mirrorStack).toHaveAttribute('data-flipped', 'true')
    await mirrorStack.getByTestId('atlas-group-open').click()

    const overlay = page.locator('[data-component="atlas-card-overlay"]')
    await expect(overlay).toBeVisible()
    await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Mirror Stack')

    // Eager preview cap (goal 0073 slice B): the first 3 mirrored
    // children in title order (Alpha/Bravo/Charlie) render their
    // markdown content inline immediately; the remaining 2
    // (Delta/Echo) show an on-demand "Show preview" button instead.
    // Under the page's own entry cap (12), all 5 render -- no expander.
    await expect(overlay.getByTestId('atlas-page-child')).toHaveCount(5)
    await expect(overlay.getByTestId('atlas-page-show-more')).toHaveCount(0)
    await expect(overlay.getByTestId('atlas-mirror-markdown')).toHaveCount(3)
    const loadButtons = overlay.getByTestId('atlas-page-load-preview')
    await expect(loadButtons).toHaveCount(2)

    await loadButtons.first().click()
    await expect(overlay.getByTestId('atlas-mirror-markdown')).toHaveCount(4)
    await expect(overlay.getByTestId('atlas-page-load-preview')).toHaveCount(1)

    await page.close()
  } finally {
    await browser.close()
    server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
