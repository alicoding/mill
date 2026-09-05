import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnMillServer, type SpawnedServer } from './fixtures/server'
import { EXTENSIONS_UPDATES_MCP_BASE_PORT, EXTENSIONS_UPDATES_SERVER_BASE_PORT } from './fixtures/serverPorts'
import { gotoAppReady } from './fixtures/appReady'
import { openExtensions, openExtensionDetail, openExtensionDetailTab, pluginRow } from './fixtures/settingsNav'

// Updates on request and the MCP servers an extension ships (goal
// 0349 S5, part 2), on their OWN dedicated server pair: a check reads
// every marketplace this Mill holds and an update rewrites a plugin
// folder -- global plugin state the shared pool must never see
// (testing.md's shared-vs-dedicated rule). Serial: each case builds on
// the state the one before it left.
//
// The fixture marketplace is COPIED to a temp folder so the publisher's
// "release" -- a version bump in the index and the manifest -- never
// touches the repository's own fixture.
test.describe.configure({ mode: 'serial' })

const FIXTURE_MARKETPLACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'marketplace')

let server: SpawnedServer
let browser: Browser
let page: Page
let dir: string
let market: string

// publishVersion is the publisher's release: the index entry and the
// plugin's own manifest both move to the given version.
function publishVersion(version: string): void {
	const indexPath = path.join(market, '.mill', 'marketplace.json')
	const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { plugins: { id: string; version: string }[] }
	for (const p of index.plugins) if (p.id === 'fixture-notes') p.version = version
	writeFileSync(indexPath, JSON.stringify(index, null, 2))
	const manifestPath = path.join(market, 'fixture-notes', 'manifest.json')
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version: string }
	manifest.version = version
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
}

test.beforeAll(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'mill-extensions-updates-'))
	const pluginsDir = path.join(dir, 'plugins')
	mkdirSync(pluginsDir, { recursive: true })
	market = path.join(dir, 'marketplace')
	cpSync(FIXTURE_MARKETPLACE, market, { recursive: true })
	server = await spawnMillServer({
		port: EXTENSIONS_UPDATES_SERVER_BASE_PORT,
		mcpPort: EXTENSIONS_UPDATES_MCP_BASE_PORT,
		settingsPath: path.join(dir, 'settings.json'),
		executionDbPath: path.join(dir, 'exec.db'),
		backupDir: path.join(dir, 'backups'),
		extraEnv: { MILL_PLUGINS_DIR: pluginsDir },
	})
	browser = await chromium.launch()
	const context = await browser.newContext({ baseURL: `http://127.0.0.1:${EXTENSIONS_UPDATES_SERVER_BASE_PORT}` })
	page = await context.newPage()
})

test.afterAll(async () => {
	await browser?.close()
	await server?.stop()
	rmSync(dir, { recursive: true, force: true })
})

async function installFromBrowse(id: string): Promise<void> {
	await openExtensions(page, 'browse')
	const entry = page.locator(`[data-testid="extensions-browse-row"][data-plugin-id="${id}"]`)
	await expect(entry).toBeVisible()
	await entry.getByTestId('extensions-browse-install').click()
	const dialog = page.getByTestId('extensions-install-dialog')
	await expect(dialog).toBeVisible()
	await page.getByRole('dialog').getByRole('button', { name: 'Install', exact: true }).click()
	await expect(dialog).toHaveCount(0)
}

test('Updates says nothing has been checked until someone asks, then that everything is current', async () => {
	await gotoAppReady(page)
	await openExtensions(page, 'browse')
	await page.getByTestId('extensions-sources-open').click()
	await page.getByTestId('extensions-source-input').fill(market)
	await page.getByTestId('extensions-source-add').click()
	await expect(page.locator('[data-testid="extensions-source-row"][data-source-name="fixture"]')).toBeVisible()
	await page.getByRole('button', { name: 'Close' }).click()
	await installFromBrowse('fixture-notes')

	await openExtensions(page, 'updates')
	await expect(page.getByTestId('extensions-updates-unchecked')).toBeVisible()
	await expect(page.getByTestId('extensions-update-all')).toHaveCount(0)
	await page.getByTestId('extensions-check-updates').click()
	await expect(page.getByTestId('extensions-updates-empty')).toBeVisible()
	await expect(page.getByTestId('extensions-updates-checked-at')).toBeVisible()
	await expect(page.getByTestId('extensions-tab-updates')).toHaveText('Updates')
})

test('An older publication is never offered', async () => {
	publishVersion('0.9.0')
	await gotoAppReady(page)
	await openExtensions(page, 'updates')
	await page.getByTestId('extensions-check-updates').click()
	await expect(page.locator('[data-testid="notice-text"]', { hasText: 'Everything is up to date.' })).toBeVisible()
	await expect(page.getByTestId('extensions-updates-empty')).toBeVisible()
	await expect(page.getByTestId('extensions-update-row')).toHaveCount(0)
})

test('A newer version is counted on the tab, confirmed through the install prompt, and lands', async () => {
	publishVersion('1.1.0')
	await gotoAppReady(page)
	await openExtensions(page, 'updates')
	await page.getByTestId('extensions-check-updates').click()
	await expect(page.getByTestId('extensions-tab-updates')).toHaveText('Updates (1)')
	const row = page.locator('[data-testid="extensions-update-row"][data-plugin-id="fixture-notes"]')
	await expect(row).toBeVisible()
	await expect(row.getByTestId('extensions-update-versions')).toHaveText('v1.0.0 → v1.1.0')
	await expect(row.getByText('Dev')).toBeVisible()
	await expect(page.getByTestId('extensions-update-all')).toBeVisible()

	// The row's own menu offers the same update, through the same command.
	await openExtensions(page, 'installed')
	await pluginRow(page, 'fixture-notes').getByTestId('extensions-row-menu').click()
	await expect(page.getByTestId('extensions-row-update')).toBeVisible()
	await page.keyboard.press('Escape')

	await openExtensions(page, 'updates')
	await row.getByTestId('extensions-update-apply').click()
	const dialog = page.getByTestId('extensions-install-dialog')
	await expect(dialog).toBeVisible()
	await expect(page.getByRole('dialog')).toContainText('Update Fixture notes?')
	await expect(dialog).toContainText('v1.1.0')
	await page.getByRole('dialog').getByRole('button', { name: 'Update', exact: true }).click()
	await expect(dialog).toHaveCount(0)
	await expect(page.locator('[data-testid="notice-text"]', { hasText: 'Updated Fixture notes to v1.1.0. Reload to load it.' })).toBeVisible()

	await expect(row).toHaveCount(0)
	await expect(page.getByTestId('extensions-updates-empty')).toBeVisible()
	await expect(page.getByTestId('extensions-tab-updates')).toHaveText('Updates')
	await openExtensions(page, 'installed')
	await expect(pluginRow(page, 'fixture-notes')).toContainText('v1.1.0')
})

test('The MCP server an extension ships is listed under Contributions and lands in Configure', async () => {
	await gotoAppReady(page)
	await installFromBrowse('mill-request-tester')
	await openExtensions(page, 'installed')
	const detail = await openExtensionDetail(page, pluginRow(page, 'mill-request-tester'), 'mill-request-tester')
	await openExtensionDetailTab(detail, 'contributions')
	const serverRow = detail.locator('[data-testid="extensions-mcp-server"][data-server-id="reference"]')
	await expect(serverRow).toBeVisible()
	await expect(serverRow).toContainText('Reference server')
	await expect(serverRow.getByTestId('extensions-mcp-server-command')).toHaveText('npx -y @modelcontextprotocol/server-everything')
	await serverRow.getByTestId('extensions-mcp-add').click()
	await expect(page.locator('[data-testid="notice-text"]', { hasText: 'Added Reference server to Configure.' })).toBeVisible()

	await page.getByRole('link', { name: 'Configure' }).click()
	await page.getByRole('tab', { name: 'MCP Servers' }).click()
	const entity = page.locator('[data-testid="inventory-row"][data-entity="mcpserver"]').filter({ has: page.getByText('Reference server', { exact: true }) })
	await expect(entity).toBeVisible()
})
