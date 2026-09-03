import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnMillServer, type SpawnedServer } from './fixtures/server'
import { TRAY_PANEL_SERVER_BASE_PORT, TRAY_PANEL_MCP_BASE_PORT } from './fixtures/serverPorts'

// The menu-bar status panel's CONTENT (docs/goals/0189): the
// /#/traypanel route is a plain hash route this server-mode harness
// loads exactly like /#/quickpanel, so every rendered state below is
// e2e-provable. The tray ATTACHMENT itself (icon click toggling,
// positioning, SetLabel, template icon, click-away dismiss) is
// OS-bound -- testing.md's manual-only registry carries those.
// Dedicated server per test: the assertions read the global
// run/pending queues, including the true empty state.

interface SpawnedPage {
  server: SpawnedServer
  browser: Browser
  page: Page
  dir: string
}

async function openDedicated(offset: number, idx: number): Promise<SpawnedPage> {
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-traypanel-${idx}-`))
  const browser = await chromium.launch()
  const server = await spawnMillServer({
    port: TRAY_PANEL_SERVER_BASE_PORT + offset + idx,
    mcpPort: TRAY_PANEL_MCP_BASE_PORT + offset + idx,
    settingsPath: path.join(dir, 'settings.json'),
    executionDbPath: path.join(dir, 'execution.db'),
    backupDir: path.join(dir, 'backups'),
  })
  const page = await browser.newPage({ baseURL: server.baseURL })
  return { server, browser, page, dir }
}

async function closeDedicated(s: SpawnedPage): Promise<void> {
  await s.browser.close()
  await s.server.stop()
  rmSync(s.dir, { recursive: true, force: true })
}

// eslint-disable-next-line no-empty-pattern -- needs testInfo (second arg), no fixture.
test('at rest the panel states presence, both honest empties, and the quit contract', async ({}, testInfo) => {
  const s = await openDedicated(0, testInfo.parallelIndex)
  try {
    const { page } = s
    await page.goto(`${s.server.baseURL}/#/traypanel`)
    const panel = page.getByTestId('tray-panel')
    await expect(panel).toBeVisible()

    // Presence + the full-app door.
    await expect(panel).toContainText('Mill')
    await expect(panel).toContainText('Running')
    await expect(page.getByTestId('tray-open-mill')).toBeVisible()

    // Both empties are honest sentences, not blank space.
    await expect(page.getByTestId('tray-nothing-waiting')).toHaveText('Nothing waiting on you.')
    await expect(page.getByTestId('tray-nothing-running')).toHaveText('Nothing running.')
    await expect(page.getByTestId('tray-no-runs-yet')).toHaveText('No runs yet.')

    // The quit contract names what stops (the seeded examples include
    // automatic triggers, so the count copy renders), and Keep
    // running collapses without quitting.
    await page.getByTestId('tray-quit').click()
    const contract = page.getByTestId('tray-quit-contract')
    await expect(contract).toContainText('Quitting stops')
    await expect(contract).toContainText('until Mill runs again')
    await expect(page.getByTestId('tray-quit-confirm')).toBeVisible()
    await page.getByTestId('tray-keep-running').click()
    await expect(contract).toHaveCount(0)
    await expect(page.getByTestId('tray-quit')).toBeVisible()
  } finally {
    await closeDedicated(s)
  }
})

// eslint-disable-next-line no-empty-pattern -- needs testInfo (second arg), no fixture.
test('a parked run surfaces as a Needs-you row naming its workflow', async ({}, testInfo) => {
  const s = await openDedicated(10, testInfo.parallelIndex)
  try {
    const { page } = s
    // Park a run through the real seeded human-review workflow (the
    // guardrail-review spec's own pattern).
    await page.goto(`${s.server.baseURL}/`)
    await page.getByRole('link', { name: 'Workflows' }).click()
    const seed = 'Example: Human review with input'
    const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(seed, { exact: true }) })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Run' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Note').fill('')
    await dialog.getByRole('button', { name: 'Run' }).click()

    // The panel, in a second tab (its own window in real life), shows
    // the parked run under Needs you -- and NOT under Running (the
    // sections partition).
    const panelPage = await s.browser.newPage({ baseURL: s.server.baseURL })
    await panelPage.goto(`${s.server.baseURL}/#/traypanel`)
    const needsRow = panelPage.getByTestId('tray-needs-row').filter({ hasText: seed })
    await expect(needsRow).toBeVisible({ timeout: 10_000 })
    await expect(needsRow).toContainText('Waiting for your approval')
    await expect(panelPage.getByTestId('tray-nothing-waiting')).toHaveCount(0)
    await expect(panelPage.getByTestId('tray-run-row')).toHaveCount(0)
  } finally {
    await closeDedicated(s)
  }
})

// goal 0294: a settled run shows under Recent with its outcome, so the
// menu bar answers "did it work" -- seeded through the Quick Panel's
// own Enter, the path the report came from.
// eslint-disable-next-line no-empty-pattern -- needs testInfo (second arg), no fixture.
test('a run started from the Quick Panel shows under Recent as done', async ({}, testInfo) => {
  // Offset 5: the file's server ports run 11160-11179 and the MCP ports
  // start at 11180, so offsets stay below 20 minus the worker count.
  const s = await openDedicated(5, testInfo.parallelIndex)
  try {
    const { page } = s
    const label = 'Backup Mill data'
    await page.goto(`${s.server.baseURL}/#/quickpanel`)
    const search = page.getByRole('combobox', { name: 'Quick Panel search' })
    await search.fill(label)
    await expect(page.getByRole('option', { name: label })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('quick-panel-status')).toContainText(`Done — "${label}"`)

    // A run that parks for approval says so, instead of "Done" (the RPC
    // returns while the run is still pending).
    const parkedLabel = 'Example: Human review with input'
    await search.fill(parkedLabel)
    await expect(page.getByRole('option', { name: parkedLabel })).toBeVisible()
    await page.keyboard.press('Enter')
    // The parked-run RPC returns once the run has parked; give a loaded
    // runner the same headroom the settled case gets.
    await expect(page.getByTestId('quick-panel-status')).toHaveText(`"${parkedLabel}" is waiting for your approval`, { timeout: 15_000 })

    const panelPage = await s.browser.newPage({ baseURL: s.server.baseURL })
    await panelPage.goto(`${s.server.baseURL}/#/traypanel`)
    const recentRow = panelPage.getByTestId('tray-recent-row').filter({ hasText: label })
    await expect(recentRow).toBeVisible({ timeout: 15_000 }) // the panel refreshes every 5s
    await expect(recentRow).toHaveAttribute('data-run-kind', 'done')
    await expect(recentRow).toContainText('Done')
    await expect(panelPage.getByTestId('tray-no-runs-yet')).toHaveCount(0)
    // The parked run is under Needs you, never under Recent.
    await expect(panelPage.getByTestId('tray-needs-row').filter({ hasText: parkedLabel })).toBeVisible()
    await expect(panelPage.getByTestId('tray-recent-row').filter({ hasText: parkedLabel })).toHaveCount(0)
  } finally {
    await closeDedicated(s)
  }
})
