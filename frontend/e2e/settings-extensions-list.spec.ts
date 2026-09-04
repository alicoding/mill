import { chromium, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnMillServer } from './fixtures/server'
import { SETTINGS_EXTENSIONS_LIST_MCP_BASE_PORT, SETTINGS_EXTENSIONS_LIST_SERVER_BASE_PORT } from './fixtures/serverPorts'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { openSettings, pluginRow } from './fixtures/settingsNav'

// The Installed plugins list on the one list standard (goal 0337 S2):
// its own toolbar (search, an own-item count) and the compiled-in
// mill-drawing plugin living in the shared Built-in disclosure --
// collapsed once the user has installed anything, expanded on an
// otherwise-empty install where mill-drawing is all there is to see.
// Dedicated servers (testing.md's shared-vs-dedicated rule): the
// installed list reads the GLOBAL PluginService.ListPlugins() response.

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('the installed list wears the toolbar and collapses Built in once real plugins are installed', async ({}, testInfo) => {
  const { page, close } = await launchWithPlugins(testInfo.parallelIndex, {
    ports: { server: SETTINGS_EXTENSIONS_LIST_SERVER_BASE_PORT, mcp: SETTINGS_EXTENSIONS_LIST_MCP_BASE_PORT },
  })
  try {
    await page.goto('/')
    await openSettings(page, 'extensions')

    // Five example plugins land on disk (launchWithPlugins' own copy)
    // -- the toolbar's count reads them, not the compiled-in one.
    await expect(page.getByTestId('list-count')).toHaveText('5')
    await expect(page.getByTestId('extensions-plugin-row')).toHaveCount(5)

    // Built in starts collapsed: the row is not rendered at all, not
    // merely hidden.
    const toggle = page.getByTestId('extensions-built-in-toggle')
    await expect(toggle).toHaveText('Built in (1)')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(pluginRow(page, 'mill-drawing')).toHaveCount(0)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(pluginRow(page, 'mill-drawing')).toBeVisible()

    // The search box narrows the installed list by name/description.
    await page.getByTestId('inventory-search').fill('bookmark')
    await expect(page.getByTestId('extensions-plugin-row')).toHaveCount(1)
  } finally {
    await close()
  }
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Built in starts expanded when nothing else is installed', async ({}, testInfo) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mill-e2e-settings-extensions-list-empty-'))
  const pluginsDir = path.join(dir, 'plugins')
  mkdirSync(pluginsDir, { recursive: true })
  const port = SETTINGS_EXTENSIONS_LIST_SERVER_BASE_PORT + 40 + testInfo.parallelIndex
  const mcpPort = SETTINGS_EXTENSIONS_LIST_MCP_BASE_PORT + 40 + testInfo.parallelIndex
  const server = await spawnMillServer({
    port, mcpPort,
    settingsPath: path.join(dir, 'settings.json'),
    executionDbPath: path.join(dir, 'exec.db'),
    backupDir: path.join(dir, 'backups'),
    extraEnv: { MILL_PLUGINS_DIR: pluginsDir },
  })
  const browser = await chromium.launch()
  const page = await browser.newPage({ baseURL: server.baseURL })
  try {
    await page.goto('/')
    await openSettings(page, 'extensions')

    // Nothing installed: the toolbar carries no own-item count, and the
    // Built-in section is already open with the compiled-in plugin in it.
    await expect(page.getByTestId('list-count')).toHaveCount(0)
    const toggle = page.getByTestId('extensions-built-in-toggle')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(pluginRow(page, 'mill-drawing')).toBeVisible()
  } finally {
    await browser.close()
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
