import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnMillServer, type SpawnedServer } from './fixtures/server'
import { RUNTIME_PLUGINS_SERVER_BASE_PORT, RUNTIME_PLUGINS_MCP_BASE_PORT } from './fixtures/serverPorts'
import { findEmptyBoardRect } from './fixtures/atlasEmptyRegion'

// The runtime plugin platform, proven against a REAL out-of-tree
// plugin (docs/goals/0249): the server boots with MILL_PLUGINS_DIR
// pointed at the repo's own examples/plugins -- the exact folder a
// user copies from -- so what this file proves is the shipping
// artifact, not a compiled-in stand-in. Dedicated server per test
// (testing.md's dedicated-spec exception): the plugins env is process-
// wide, and the Review-queue assertions read the global pending list.
const EXAMPLES_PLUGINS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'examples', 'plugins')

async function launchWithPlugins(offset: number) {
	const dir = mkdtempSync(path.join(tmpdir(), 'mill-plugins-e2e-'))
	const server: SpawnedServer = await spawnMillServer({
		port: RUNTIME_PLUGINS_SERVER_BASE_PORT + offset,
		mcpPort: RUNTIME_PLUGINS_MCP_BASE_PORT + offset,
		settingsPath: path.join(dir, 'settings.json'),
		executionDbPath: path.join(dir, 'exec.db'),
		backupDir: path.join(dir, 'backups'),
		extraEnv: { MILL_PLUGINS_DIR: EXAMPLES_PLUGINS_DIR },
	})
	const browser = await chromium.launch()
	const context = await browser.newContext({ baseURL: `http://127.0.0.1:${RUNTIME_PLUGINS_SERVER_BASE_PORT + offset}` })
	const page = await context.newPage()
	return {
		page,
		async close() {
			await browser.close()
			await server.stop()
			rmSync(dir, { recursive: true, force: true })
		},
	}
}

test('a dropped plugin folder yields a working canvas object: tray entry, placement, face render, payload edit, reload persistence', async () => {
	const { page, close } = await launchWithPlugins(0)
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		const board = page.getByTestId('atlas-board')
		await expect(board).toBeVisible()

		// The plugin's tool is IN the tray, by its own declared label.
		const bookmarkBtn = page.locator('[data-testid="atlas-creation-tray"] button[aria-label="Bookmark"]')
		await expect(bookmarkBtn).toBeVisible()

		// Armed click places a bookmark object; the plugin's own
		// renderFace draws the face.
		await bookmarkBtn.click()
		const spot = await findEmptyBoardRect(page, board, 300, 200)
		const bb = await board.boundingBox()
		if (!bb) throw new Error('board has no bounding box')
		await board.click({ position: { x: spot.x - bb.x + 10, y: spot.y - bb.y + 10 } })
		const face = page.locator('[data-testid="plugin-face-bookmark"]')
		await expect(face).toBeVisible()

		// The face's URL field writes through the host's content-plane
		// door; the plugin derives the title from the committed value.
		await face.locator('[data-testid="bookmark-url-input"]').click()
		await page.keyboard.type('example.com/docs')
		await page.keyboard.press('Enter')
		await expect(face.locator('[data-testid="bookmark-url-input"]')).toHaveValue('example.com/docs')
		await expect(face.locator('span').nth(1)).toHaveText('example.com')

		// The object is REAL content-plane data: it survives a reload
		// and renders through the plugin again.
		await page.reload()
		await page.getByRole('link', { name: 'Atlas' }).click()
		await expect(page.locator('[data-testid="plugin-face-bookmark"]')).toBeVisible()
		await expect(page.locator('[data-testid="bookmark-url-input"]')).toHaveValue('example.com/docs')
	} finally {
		await close()
	}
})

test('a guarded action parks for the human, renders in Review, and the approve/deny answer reaches the plugin', async () => {
	const { page, close } = await launchWithPlugins(2)
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		const board = page.getByTestId('atlas-board')
		await expect(board).toBeVisible()
		await page.locator('[data-testid="atlas-creation-tray"] button[aria-label="Bookmark"]').click()
		const spot = await findEmptyBoardRect(page, board, 300, 200)
		const bb = await board.boundingBox()
		if (!bb) throw new Error('board has no bounding box')
		await board.click({ position: { x: spot.x - bb.x + 10, y: spot.y - bb.y + 10 } })
		const face = page.locator('[data-testid="plugin-face-bookmark"]')
		await expect(face).toBeVisible()
		await face.locator('[data-testid="bookmark-url-input"]').click()
		await page.keyboard.type('example.com')
		await page.keyboard.press('Enter')

		// Open asks the guardrail; ClassExternal's ask-by-default parks.
		await face.locator('[data-testid="bookmark-open"]').click()
		await expect(face.locator('[data-testid="bookmark-status"]')).toHaveText('Asking…')

		// The park is visible and actionable in Review -- approved from a
		// SECOND tab, so the asking face stays mounted and receives the
		// answer (the waiting caller's result lands in the live face; a
		// same-tab navigation would unmount it, which is why the
		// approval surfaces are separate windows in the real app).
		const reviewPage = await page.context().newPage()
		await reviewPage.goto('/')
		await reviewPage.getByRole('link', { name: 'Review' }).click()
		const row = reviewPage.locator('[data-testid="review-guarded-action-item"]')
		await expect(row).toBeVisible()
		await expect(row.locator('[data-testid="review-guarded-action-source"]')).toContainText('plugin:mill-bookmark')

		// Approve: the blocked plugin call wakes; Mill performs the open
		// itself (a documented no-op in server mode -- the decision
		// round-trip is what this asserts).
		await row.locator('[data-testid="review-guarded-action-approve"]').click()
		await expect(row).toHaveCount(0)
		await expect(face.locator('[data-testid="bookmark-status"]')).toHaveText('Opened.')

		// Deny round: the answer reaches the plugin as not-allowed.
		await face.locator('[data-testid="bookmark-open"]').click()
		await expect(row).toBeVisible()
		await row.locator('[data-testid="review-guarded-action-deny"]').click()
		await expect(row).toHaveCount(0)
		await expect(face.locator('[data-testid="bookmark-status"]')).toContainText('Not allowed')
		await reviewPage.close()
	} finally {
		await close()
	}
})
