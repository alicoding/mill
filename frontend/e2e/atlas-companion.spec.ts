import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawnMillServer, type SpawnedServer } from './fixtures/server'
import { noteCard } from './fixtures/atlasBoard'
import { clickRowAction } from './inventoryRow'

// docs/goals/0101-atlas-ai-companion.md slice 1: the companion panel
// reads/writes the GLOBAL AIProviders list, a Configure entity every
// other spec file can also create/delete -- and this file's own
// empty-provider-state assertion needs that list to be EXACTLY empty,
// a state no shared-pool spec may assume (.claude/rules/testing.md's
// dedicated-server rule). Own port range, clear of every other spec's.
const SERVER_BASE_PORT = 10480
const MCP_BASE_PORT = 10500

test.setTimeout(120_000)

// A minimal OpenAI-compatible /v1/chat/completions SSE fixture --
// mirrors mcp-fixture-server.mjs's "test against something real, not a
// mock" bar: the real Go backend's aiclient.Chat streams against this
// exactly as it would against a real local Ollama, proving the whole
// stack (SSE parse -> delta events -> reply parse -> proposal card ->
// materialize-on-accept) end to end.
function startFakeProvider(replyJSON: string): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const words = replyJSON.split(' ')
      let i = 0
      const timer = setInterval(() => {
        if (i >= words.length) {
          res.write('data: [DONE]\n\n')
          res.end()
          clearInterval(timer)
          return
        }
        const content = (i > 0 ? ' ' : '') + words[i]
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
        i++
      }, 5)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) })
    })
  })
}

async function openAtlas(page: import('@playwright/test').Page, baseURL: string) {
  await page.goto(`${baseURL}/`)
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
}

async function createProvider(page: import('@playwright/test').Page, baseURL: string, label: string, providerBaseURL: string) {
  await page.goto(`${baseURL}/`)
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'AI Providers', exact: true }).click()
  await page.getByTestId('new-aiprovider').click()
  await page.getByLabel('Label').fill(label)
  await page.getByPlaceholder('http://localhost:11434').fill(providerBaseURL)
  await page.getByPlaceholder('llama3.2').fill('e2e-model')
  await page.getByRole('button', { name: 'Save AI provider' }).click()
  await expect(page.locator('[data-testid="inventory-row"][data-entity="aiprovider"]').filter({ has: page.getByText(label, { exact: true }) })).toBeVisible()
}

// The seeded "Local Ollama" AI provider (docs/goals/0031) is
// reference-integrity-protected while its two seeded example workflows
// still name it -- deleting those first is what a real user would do
// too, not a test-only bypass.
async function deleteSeededProvider(page: import('@playwright/test').Page, baseURL: string) {
  await page.goto(`${baseURL}/`)
  await page.getByRole('link', { name: 'Workflows' }).click()
  for (const label of ['Example: Summarize with local AI', 'Example: AI classify -> branch']) {
    const workflowRow = page.locator('[data-testid="inventory-row"]').filter({ has: page.getByText(label, { exact: true }) })
    await clickRowAction(page, workflowRow, 'Delete')
    await expect(workflowRow).not.toBeVisible()
  }

  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'AI Providers', exact: true }).click()
  const row = page.locator('[data-testid="inventory-row"][data-entity="aiprovider"]').filter({ has: page.getByText('Local Ollama', { exact: false }) })
  await clickRowAction(page, row, 'Delete')
  await expect(row).not.toBeVisible()
}

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('the AI toolbar button toggles the companion panel; Escape closes it', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-companion-toggle-${idx}-`))
  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({
      port: SERVER_BASE_PORT + idx, mcpPort: MCP_BASE_PORT + idx,
      settingsPath: path.join(dir, 'settings.json'), executionDbPath: path.join(dir, 'execution.db'), backupDir: path.join(dir, 'backups'),
    })
    const page = await browser.newPage()
    await openAtlas(page, server.baseURL)

    const panel = page.getByTestId('companion-panel')
    await expect(panel).not.toBeVisible()
    await page.getByTestId('atlas-open-companion').click()
    await expect(panel).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).not.toBeVisible()
  } finally {
    await server?.stop()
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('the empty-provider state renders its copy and offers Configure', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-companion-empty-${idx}-`))
  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({
      port: SERVER_BASE_PORT + 10 + idx, mcpPort: MCP_BASE_PORT + 10 + idx,
      settingsPath: path.join(dir, 'settings.json'), executionDbPath: path.join(dir, 'execution.db'), backupDir: path.join(dir, 'backups'),
    })
    const page = await browser.newPage()
    await deleteSeededProvider(page, server.baseURL)
    await openAtlas(page, server.baseURL)

    await page.getByTestId('atlas-open-companion').click()
    const empty = page.getByTestId('companion-provider-empty')
    await expect(empty).toBeVisible()
    await expect(empty).toContainText('Add an AI provider in Configure to start')
    await empty.getByRole('button', { name: 'Open Configure' }).click()
    await expect(page.getByRole('tab', { name: 'AI Providers', exact: true })).toBeVisible()
  } finally {
    await server?.stop()
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('sending a message streams a reply, the provider picker lists it, and Accept creates the card', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-companion-send-${idx}-`))
  let server: SpawnedServer | undefined
  let fakeProvider: { url: string; close: () => Promise<void> } | undefined
  const browser = await chromium.launch()
  try {
    const reply = JSON.stringify({ mill: 1, kind: 'reply', action: 'create-cards', items: [{ title: 'ZzCompanionCard' }] }, null, 1)
    fakeProvider = await startFakeProvider(reply)

    server = await spawnMillServer({
      port: SERVER_BASE_PORT + 20 + idx, mcpPort: MCP_BASE_PORT + 20 + idx,
      settingsPath: path.join(dir, 'settings.json'), executionDbPath: path.join(dir, 'execution.db'), backupDir: path.join(dir, 'backups'),
    })
    const page = await browser.newPage()
    await createProvider(page, server.baseURL, 'ZzFakeProvider', fakeProvider.url)
    await openAtlas(page, server.baseURL)

    await page.getByTestId('atlas-open-companion').click()
    const providerSelect = page.getByTestId('companion-provider-select')
    await expect(providerSelect).toContainText('ZzFakeProvider')
    // The seeded "Local Ollama" example provider is also present and
    // selected by default (first in the list) -- explicitly pick the
    // fake provider so this turn actually hits the fixture server, not
    // an unreachable real localhost:11434.
    await providerSelect.selectOption({ label: 'ZzFakeProvider' })

    await page.getByTestId('companion-composer').fill('organize this')
    await page.getByTestId('companion-send').click()

    const proposal = page.getByTestId('companion-proposal')
    await expect(proposal).toBeVisible({ timeout: 15_000 })
    await expect(proposal).toContainText('ZzCompanionCard')
    await page.getByTestId('companion-proposal-accept').click()
    await expect(page.getByTestId('companion-proposal-accepted')).toBeVisible()

    await page.getByTestId('atlas-open-companion').click()
    // materializeReplyItems always creates at TRUE root (parentID ""),
    // never the currently-viewed space -- the default landing view
    // auto-drills into "My space" (the seeded single root card), so
    // the new card needs the "All spaces" breadcrumb to come into view
    // (it now renders since there are 2 root cards, no longer 1).
    await page.getByTestId('atlas-breadcrumb').getByText('All spaces').click()
    await expect(noteCard(page, 'ZzCompanionCard')).toBeVisible()
  } finally {
    await server?.stop()
    await fakeProvider?.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
