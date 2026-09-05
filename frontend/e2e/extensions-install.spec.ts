import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnMillServer, type SpawnedServer } from './fixtures/server'
import { EXTENSIONS_INSTALL_MCP_BASE_PORT, EXTENSIONS_INSTALL_SERVER_BASE_PORT } from './fixtures/serverPorts'
import { gotoAppReady } from './fixtures/appReady'
import { openExtensions } from './fixtures/settingsNav'

// Installing from an ARCHIVE address (goal 0349), on its own dedicated
// server pair for the same reason extensions-store.spec.ts takes one:
// an install changes this Mill's whole plugins directory.
//
// The marketplace and the archive are served by a throwaway loopback
// server this spec starts and stops itself -- the install path is
// exercised end to end without any host outside this machine, which is
// also the only way SPEC §1.1's zero-outbound rule stays true in a test.
test.describe.configure({ mode: 'serial' })

let server: SpawnedServer
let browser: Browser
let page: Page
let dir: string
let publisher: Server
let publisherURL: string

function buildArchive(root: string): Buffer {
	const staging = path.join(root, 'staging', 'archive-notes')
	mkdirSync(staging, { recursive: true })
	writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify({
		id: 'archive-notes',
		name: 'Archive notes',
		version: '1.0.0',
		author: 'Archive publisher',
		description: 'An extension installed from an address.',
		capabilities: ['write-content'],
		contributes: { network: [{ host: 'archive.example.test' }] },
	}))
	writeFileSync(path.join(staging, 'main.js'), 'export function activate() {}\n')
	const zipPath = path.join(root, 'archive-notes-1.0.0.zip')
	execFileSync('zip', ['-r', '-q', zipPath, 'archive-notes'], { cwd: path.join(root, 'staging') })
	return readFileSync(zipPath)
}

test.beforeAll(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'mill-extensions-install-'))
	const pluginsDir = path.join(dir, 'plugins')
	mkdirSync(pluginsDir, { recursive: true })
	const archive = buildArchive(dir)

	await new Promise<void>((resolve) => {
		publisher = createServer((req, res) => {
			if (req.url === '/.mill/marketplace.json') {
				res.writeHead(200, { 'content-type': 'application/json' })
				res.end(JSON.stringify({
					name: 'archive-market',
					owner: { name: 'Archive publisher' },
					plugins: [{
						id: 'archive-notes',
						name: 'Archive notes',
						description: 'An extension installed from an address.',
						version: '1.0.0',
						author: 'Archive publisher',
						source: { kind: 'archive', url: `${publisherURL}/archive-notes-1.0.0.zip` },
					}],
				}))
				return
			}
			if (req.url === '/archive-notes-1.0.0.zip') {
				res.writeHead(200, { 'content-type': 'application/zip' })
				res.end(archive)
				return
			}
			res.writeHead(404)
			res.end()
		})
		publisher.listen(0, '127.0.0.1', () => {
			const address = publisher.address()
			const port = typeof address === 'object' && address ? address.port : 0
			publisherURL = `http://127.0.0.1:${port}`
			resolve()
		})
	})

	server = await spawnMillServer({
		port: EXTENSIONS_INSTALL_SERVER_BASE_PORT,
		mcpPort: EXTENSIONS_INSTALL_MCP_BASE_PORT,
		settingsPath: path.join(dir, 'settings.json'),
		executionDbPath: path.join(dir, 'exec.db'),
		backupDir: path.join(dir, 'backups'),
		extraEnv: { MILL_PLUGINS_DIR: pluginsDir },
	})
	browser = await chromium.launch()
	const context = await browser.newContext({ baseURL: `http://127.0.0.1:${EXTENSIONS_INSTALL_SERVER_BASE_PORT}` })
	page = await context.newPage()
})

test.afterAll(async () => {
	await browser?.close()
	await server?.stop()
	await new Promise<void>((resolve) => publisher?.close(() => resolve()))
	rmSync(dir, { recursive: true, force: true })
})

test('An index address is added as a source and its archive entry is offered as unverified', async () => {
	await gotoAppReady(page)
	await openExtensions(page, 'browse')
	await page.getByTestId('extensions-sources-open').click()
	await page.getByTestId('extensions-source-input').fill(`${publisherURL}/.mill/marketplace.json`)
	await page.getByTestId('extensions-source-add').click()
	await expect(page.locator('[data-testid="extensions-source-row"][data-source-name="archive-market"]')).toBeVisible()
	await page.getByRole('button', { name: 'Close' }).click()

	const entry = page.locator('[data-testid="extensions-browse-row"][data-plugin-id="archive-notes"]')
	await expect(entry).toBeVisible()
	// No declared hash means nothing can check the download.
	await expect(entry.getByText('Unverified')).toBeVisible()
})

test('An unverified install waits for the acknowledgment, then lands wearing its tier', async () => {
	await gotoAppReady(page)
	await openExtensions(page, 'browse')
	const entry = page.locator('[data-testid="extensions-browse-row"][data-plugin-id="archive-notes"]')
	await entry.getByTestId('extensions-browse-install').click()

	const dialog = page.getByTestId('extensions-install-dialog')
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText('Install unreviewed code?')
	await expect(dialog.getByTestId('extensions-install-unreviewed-body')).toBeVisible()

	const install = dialog.getByRole('button', { name: 'Install', exact: true })
	await expect(install).toBeDisabled()
	await dialog.getByTestId('extensions-install-acknowledge').check()
	await expect(install).toBeEnabled()
	await install.click()
	await expect(dialog).toHaveCount(0)

	await openExtensions(page, 'installed')
	const row = page.locator('[data-testid="extensions-plugin-row"][data-plugin-id="archive-notes"]')
	await expect(row).toBeVisible()
	await expect(row.getByTestId('extensions-row-tier')).toHaveText('Unverified')

	await row.getByTestId('extensions-row-open').click()
	const detail = page.locator('[data-testid="extensions-detail"][data-extension-id="archive-notes"]')
	await detail.getByTestId('extensions-detail-tab-verification').click()
	await expect(detail.getByTestId('extensions-verification-sentence'))
		.toHaveText('Nothing checked these files when they were installed.')
	await expect(detail.getByTestId('extensions-verification-permissions')).toContainText('archive.example.test')
})
