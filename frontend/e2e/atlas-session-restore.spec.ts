import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ATLAS_SESSION_MCP_BASE_PORT,
  ATLAS_SESSION_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { clickBreadcrumbSegment, groupCard, noteCard, openCard } from './fixtures/atlasBoard'

// Session restore (goal 0091): the viewed level and open card persist
// server-side and come back on the next mount. Its OWN server
// deliberately: the shared worker pool runs with
// MILL_TEST_ATLAS_SESSION_OFF so restore-on-mount can't hand every
// other test the previous test's position -- this spec is the one
// place the feature runs live, against a fresh server whose only
// session writer is this test.

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('session restore: the viewed level and open card survive a reload (goal 0091)', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-atlas-session-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = ATLAS_SESSION_SERVER_BASE_PORT + idx
  const mcpPort = ATLAS_SESSION_MCP_BASE_PORT + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({ port, mcpPort, settingsPath, executionDbPath, backupDir })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(page.getByTestId('atlas-board')).toBeVisible()

    await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')
    await openCard(page, noteCard(page, 'Jordan Reyes'))
    const overlay = page.locator('[data-component="atlas-card-overlay"]')
    await expect(overlay).toBeVisible()

    await page.reload()
    await expect(page.getByTestId('atlas-board')).toBeVisible()
    // Landed back inside Client records with Jordan's page re-opened.
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')
    await expect(overlay).toBeVisible()
    await expect(overlay).toContainText('Jordan Reyes')

    // Close the page and step up a level, reload again: the cleared
    // overlay must STAY cleared and the new level must stick -- a
    // restore that only ever re-adds state would ghost the page back.
    await page.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()
    await clickBreadcrumbSegment(page, page.getByTestId('atlas-breadcrumb').getByText('The engagement'), 'The engagement')
    await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('Client records')
    await page.reload()
    await expect(page.getByTestId('atlas-board')).toBeVisible()
    await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('Client records')
    await expect(overlay).not.toBeVisible()
  } finally {
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
