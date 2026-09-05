import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnMillServer, type SpawnedServer } from './fixtures/server'
import { EXTENSIONS_STORE_MCP_BASE_PORT, EXTENSIONS_STORE_SERVER_BASE_PORT } from './fixtures/serverPorts'
import { gotoAppReady } from './fixtures/appReady'
import { openExtensions } from './fixtures/settingsNav'

// The Extensions surface (goal 0349), on its OWN dedicated server pair:
// adding a marketplace source and installing from it change GLOBAL
// plugin state -- what this Mill's plugins directory holds and which
// marketplaces it reads -- which the shared pool must never see
// (testing.md's shared-vs-dedicated rule). Serial, because each case
// builds on the state the one before it left.
test.describe.configure({ mode: 'serial' })

const FIXTURE_MARKETPLACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'marketplace')

let server: SpawnedServer
let browser: Browser
let page: Page
let dir: string

test.beforeAll(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'mill-extensions-store-'))
	const pluginsDir = path.join(dir, 'plugins')
	mkdirSync(pluginsDir, { recursive: true })
	server = await spawnMillServer({
		port: EXTENSIONS_STORE_SERVER_BASE_PORT,
		mcpPort: EXTENSIONS_STORE_MCP_BASE_PORT,
		settingsPath: path.join(dir, 'settings.json'),
		executionDbPath: path.join(dir, 'exec.db'),
		backupDir: path.join(dir, 'backups'),
		extraEnv: { MILL_PLUGINS_DIR: pluginsDir },
	})
	browser = await chromium.launch()
	const context = await browser.newContext({ baseURL: `http://127.0.0.1:${EXTENSIONS_STORE_SERVER_BASE_PORT}` })
	page = await context.newPage()
})

test.afterAll(async () => {
	await browser?.close()
	await server?.stop()
	rmSync(dir, { recursive: true, force: true })
})

test('Extensions is its own destination, reachable from the sidebar and by its shortcut', async () => {
	await gotoAppReady(page)
	await page.getByRole('link', { name: 'Extensions' }).click()
	await expect(page.getByTestId('extensions-view')).toBeVisible()
	await expect(page.getByRole('heading', { name: 'Extensions', level: 1 })).toBeVisible()
	await expect(page.getByTestId('extensions-tab-installed')).toBeVisible()
	await expect(page.getByTestId('extensions-tab-browse')).toBeVisible()
	await expect(page.getByTestId('extensions-tab-updates')).toBeVisible()

	// The shortcut reaches it from anywhere else.
	await page.getByRole('link', { name: 'Home' }).click()
	await expect(page.getByTestId('extensions-view')).toHaveCount(0)
	await page.keyboard.press('Shift+Meta+X')
	await expect(page.getByTestId('extensions-view')).toBeVisible()
})

test('Browse offers the extensions Mill ships, before any source is added', async () => {
	await gotoAppReady(page)
	await openExtensions(page, 'browse')
	await expect(page.getByTestId('extensions-browse')).toBeVisible()
	const rows = page.getByTestId('extensions-browse-row')
	await expect(rows.first()).toBeVisible()
	// Everything the binary carries is offered as "mill", verified --
	// it installs out of the binary, so nothing has to be fetched.
	await expect(rows.first()).toContainText('mill')
	await expect(rows.first().getByText('Verified')).toBeVisible()
})

test('A folder marketplace is added from Sources and its entries appear in Browse', async () => {
	await gotoAppReady(page)
	await openExtensions(page, 'browse')
	await page.getByTestId('extensions-sources-open').click()
	await expect(page.getByTestId('extensions-sources-dialog')).toBeVisible()
	await expect(page.getByTestId('extensions-sources-empty')).toBeVisible()

	await page.getByTestId('extensions-source-input').fill(FIXTURE_MARKETPLACE)
	await page.getByTestId('extensions-source-add').click()
	const sourceRow = page.locator('[data-testid="extensions-source-row"][data-source-name="fixture"]')
	await expect(sourceRow).toBeVisible()
	await expect(sourceRow).toContainText(FIXTURE_MARKETPLACE)

	await page.getByRole('button', { name: 'Close' }).click()
	const entry = page.locator('[data-testid="extensions-browse-row"][data-plugin-id="fixture-notes"]')
	await expect(entry).toBeVisible()
	await expect(entry).toContainText('fixture')
})

// The permission list is the point of the prompt: what an extension can
// do is stated BEFORE it lands, at every tier.
test('Installing states what the extension can do, and the installed row wears its tier', async () => {
	await gotoAppReady(page)
	await openExtensions(page, 'browse')
	const entry = page.locator('[data-testid="extensions-browse-row"][data-plugin-id="fixture-notes"]')
	await expect(entry).toBeVisible()
	await entry.getByTestId('extensions-browse-install').click()

	const dialog = page.getByTestId('extensions-install-dialog')
	await expect(dialog).toBeVisible()
	// The declared host is named, in the user's words, before install.
	await expect(dialog.getByTestId('extensions-install-permissions')).toContainText('notes.example.test')
	await dialog.getByRole('button', { name: 'Install', exact: true }).click()
	await expect(dialog).toHaveCount(0)

	await openExtensions(page, 'installed')
	const row = page.locator('[data-testid="extensions-plugin-row"][data-plugin-id="fixture-notes"]')
	await expect(row).toBeVisible()
	await expect(row.getByTestId('extensions-row-tier')).toHaveText('Dev')
})

test('An installed extension reads its overview, its changelog and its verification', async () => {
	await gotoAppReady(page)
	await openExtensions(page, 'installed')
	const row = page.locator('[data-testid="extensions-plugin-row"][data-plugin-id="fixture-notes"]')
	await expect(row).toBeVisible()
	await row.getByTestId('extensions-row-open').click()
	const detail = page.locator('[data-testid="extensions-detail"][data-extension-id="fixture-notes"]')
	await expect(detail).toBeVisible()
	await expect(detail).toContainText('The overview an Extensions spec reads')

	await detail.getByTestId('extensions-detail-tab-changelog').click()
	await expect(detail).toContainText('First version.')

	await detail.getByTestId('extensions-detail-tab-verification').click()
	await expect(detail.getByTestId('extensions-verification-sentence'))
		.toHaveText('Installed from a folder on this Mac; nothing verifies it.')
	await expect(detail.getByTestId('extensions-verification-permissions')).toContainText('notes.example.test')
})

test('Remove asks first, names the extension, and takes its row away', async () => {
	await gotoAppReady(page)
	await openExtensions(page, 'installed')
	const row = page.locator('[data-testid="extensions-plugin-row"][data-plugin-id="fixture-notes"]')
	await expect(row).toBeVisible()
	await row.getByTestId('extensions-row-menu').click()
	await page.getByTestId('extensions-row-remove').click()
	const confirm = page.getByRole('alertdialog')
	await expect(confirm).toContainText('Remove Fixture notes?')
	await confirm.getByRole('button', { name: 'Remove', exact: true }).click()
	await expect(row).toHaveCount(0)
})

test('Removing the source takes its offering out of Browse; installed extensions stay', async () => {
	await gotoAppReady(page)
	await openExtensions(page, 'browse')
	await page.getByTestId('extensions-sources-open').click()
	const sourceRow = page.locator('[data-testid="extensions-source-row"][data-source-name="fixture"]')
	await expect(sourceRow).toBeVisible()
	await sourceRow.getByTestId('extensions-source-remove').click()
	await expect(page.getByTestId('extensions-sources-empty')).toBeVisible()
	await page.getByRole('button', { name: 'Close' }).click()
	await expect(page.locator('[data-testid="extensions-browse-row"][data-plugin-id="fixture-notes"]')).toHaveCount(0)
})
