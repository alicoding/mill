import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  PAUSED_RUNS_MCP_BASE_PORT,
  PAUSED_RUNS_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { activePanel, workflowRow } from './fixtures/canvas'

// Where a paused run lives (goal 0328): a step-mode pause is a STATE of
// a run, not a decision anyone is being asked for, so Review must never
// list or count it and Activity must show it as a status with the two
// actions that answer it. Leaving the editor with one still parked asks
// once what should happen to it.
//
// Its own dedicated server (fixtures/serverPorts.ts's PAUSED_RUNS_*),
// not the shared pool: every assertion below reads GLOBAL state -- the
// Review queue, the sidebar's pending badge, the cross-workflow runs
// list -- which another spec cohabiting one worker's server would
// contaminate (.claude/rules/testing.md's shared-vs-dedicated rule).

const SEED = 'Route an expense by amount'

interface SpawnedPage {
  server: SpawnedServer
  browser: Browser
  page: Page
  dir: string
}

async function openDedicatedServer(offset: number, idx: number): Promise<SpawnedPage> {
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-paused-runs-${idx}-`))
  const browser = await chromium.launch()
  const server = await spawnMillServer({
    port: PAUSED_RUNS_SERVER_BASE_PORT + offset + idx,
    mcpPort: PAUSED_RUNS_MCP_BASE_PORT + offset + idx,
    settingsPath: path.join(dir, 'settings.json'),
    executionDbPath: path.join(dir, 'execution.db'),
    backupDir: path.join(dir, 'backups'),
  })
  const page = await browser.newPage({ baseURL: server.baseURL })
  return { server, browser, page, dir }
}

async function closeDedicatedServer(s: SpawnedPage): Promise<void> {
  await s.browser.close()
  await s.server.stop()
  rmSync(s.dir, { recursive: true, force: true })
}

// Starts the seeded workflow step by step and waits for its first park.
// Every test here leaves the run either resumed to a terminal status or
// stopped, so no park outlives its own test.
async function startSteppedRun(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await workflowRow(page, SEED).click()
  await expect(activePanel(page).locator('.react-flow__node').first()).toBeVisible()
  await activePanel(page).getByTestId('canvas-run-menu').click()
  await page.getByTestId('canvas-run-stepped').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Amount').fill('150')
  await dialog.getByRole('button', { name: 'Run' }).click()
  await expect(activePanel(page).getByTestId('run-state-dock')).toContainText('Paused at ', { timeout: 15_000 })
}

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('A step-mode pause stays out of Review and its badge, and is answerable from Activity', async ({}, testInfo) => {
  const s = await openDedicatedServer(0, testInfo.parallelIndex)
  try {
    const { page } = s
    await startSteppedRun(page)

    // Review is for decisions a person is asked to make. Nobody was
    // asked anything here, so the queue stays empty and the sidebar
    // badge -- which reads the same source -- never appears.
    await page.getByRole('link', { name: 'Review' }).click()
    await expect(page.getByTestId('review-empty')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('review-item')).toHaveCount(0)
    await expect(page.getByTestId('review-pending-count')).toHaveCount(0)

    // Activity's runs list carries it as a status, with the two actions
    // that answer a pause.
    await page.getByRole('link', { name: 'Activity' }).click()
    const explorer = page.getByTestId('activity-runs-explorer')
    await expect(explorer).toBeVisible()
    await explorer.getByTestId('runs-explorer-status-filter').selectOption('paused')
    const row = explorer.locator('tbody tr').first()
    await expect(row).toContainText('Paused', { timeout: 10_000 })
    await expect(row.getByTestId('activity-run-continue')).toBeVisible()
    await expect(row.getByTestId('activity-run-stop')).toBeVisible()

    // Continue from here finishes the run: the same command the canvas
    // dock fires, so the two surfaces can never disagree.
    await row.getByTestId('activity-run-continue').click()
    await explorer.getByTestId('runs-explorer-status-filter').selectOption('all')
    await expect(explorer.locator('tbody tr').first()).toContainText('SUCCESS', { timeout: 20_000 })
  } finally {
    await closeDedicatedServer(s)
  }
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Leaving the editor with a run paused asks once: Stop run ends it, Keep it paused leaves it listed', async ({}, testInfo) => {
  const s = await openDedicatedServer(2, testInfo.parallelIndex)
  try {
    const { page } = s
    await startSteppedRun(page)

    // Keep it paused: the tab closes, the run stays on Activity.
    await page.getByRole('button', { name: 'Close tab' }).last().click()
    const sheet = page.getByRole('alertdialog')
    await expect(sheet).toContainText('Stop the paused run?')
    await sheet.getByRole('button', { name: 'Keep it paused' }).click()

    await page.getByRole('link', { name: 'Activity' }).click()
    const explorer = page.getByTestId('activity-runs-explorer')
    await explorer.getByTestId('runs-explorer-status-filter').selectOption('paused')
    await expect(explorer.locator('tbody tr')).toHaveCount(1, { timeout: 10_000 })

    // Reopen and leave again, this time stopping: the run reaches a
    // terminal status rather than being left parked for the next spec.
    await page.getByRole('link', { name: 'Workflows' }).click()
    await workflowRow(page, SEED).click()
    await expect(activePanel(page).getByTestId('run-state-dock')).toContainText('Paused at ', { timeout: 15_000 })
    await page.getByRole('button', { name: 'Close tab' }).last().click()
    await expect(page.getByRole('alertdialog')).toContainText('Stop the paused run?')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Stop run' }).click()

    await page.getByRole('link', { name: 'Activity' }).click()
    await explorer.getByTestId('runs-explorer-status-filter').selectOption('all')
    await expect(explorer.locator('tbody tr').first()).toContainText('CANCELLED', { timeout: 20_000 })
  } finally {
    await closeDedicatedServer(s)
  }
})
