import { chromium, expect, test } from '@playwright/test'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnMillServer, type SpawnedServer } from './fixtures/server'
import { RUNTIME_PLUGINS_SERVER_BASE_PORT, RUNTIME_PLUGINS_MCP_BASE_PORT } from './fixtures/serverPorts'
import { launchWithPlugins, EXAMPLES_PLUGINS_DIR } from './fixtures/runtimePlugins'
import { findEmptyBoardRect } from './fixtures/atlasEmptyRegion'
import { clickBoardPoint, dragBetween } from './fixtures/atlasBoard'
import { openExtensionDetail, openSettings, pluginRow } from './fixtures/settingsNav'

// The runtime plugin platform, proven against a REAL out-of-tree
// plugin (docs/goals/0249): the server boots with MILL_PLUGINS_DIR
// pointed at the repo's own examples/plugins -- the exact folder a
// user copies from -- so what this file proves is the shipping
// artifact, not a compiled-in stand-in. Dedicated server per test
// (testing.md's dedicated-spec exception): the plugins env is process-
// wide, and the Review-queue assertions read the global pending list.
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
		await face.locator('[data-testid="bookmark-url-input"]').fill('example.com/docs') // fill: a form control; per-keystroke typing drops characters under CI load (goal 0296)
		await face.locator('[data-testid="bookmark-url-input"]').press('Enter')
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
		await face.locator('[data-testid="bookmark-url-input"]').fill('example.com') // fill: a form control; per-keystroke typing drops characters under CI load (goal 0296)
		await face.locator('[data-testid="bookmark-url-input"]').press('Enter')
		// The commit re-renders the face (payload change); wait for the
		// derived title so the Open click below hits the CURRENT
		// elements, not the doomed pre-commit ones a slower runner can
		// still be swapping out.
		await expect(face.locator('span').nth(1)).toHaveText('example.com')

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

test('the Extensions page tells the install story: plugin row with manifest metadata and capabilities, a broken plugin names its error, no duplicate compiled-in row', async () => {
	const { page, close } = await launchWithPlugins(4, { withBroken: true })
	try {
		await page.goto('/')
		await openSettings(page, 'extensions')
		const section = page.locator('[data-testid="extensions-installed-plugins"]')
		await section.scrollIntoViewIfNeeded()
		await expect(section).toBeVisible()

		// The row is identity only (goal 0321): name, one line, switch.
		const bookmarkRow = pluginRow(page, 'mill-bookmark')
		await expect(bookmarkRow).toContainText('Bookmark')
		await expect(bookmarkRow.locator('[data-testid="extensions-plugin-toggle"]')).toBeVisible()

		// Version, capabilities and the ingestion claims (goal 0251)
		// read in its detail pane -- declare-first: what the plugin
		// catches is visible before it ever runs.
		const bookmarkDetail = await openExtensionDetail(page, bookmarkRow, 'mill-bookmark')
		await expect(bookmarkDetail).toContainText('1.0.0')
		await expect(bookmarkDetail).toContainText('open-url')
		await expect(bookmarkDetail.locator('[data-testid="extensions-detail-claim"]').first()).toBeVisible()
		await expect(bookmarkDetail).toContainText('web links pasted')

		// A broken folder is a visible row naming its exact problem --
		// never silently skipped, never a switch pretending it could run.
		const brokenRow = pluginRow(page, 'broken-one')
		await expect(brokenRow.locator('[data-testid="extensions-plugin-toggle"]')).toHaveCount(0)
		const brokenDetail = await openExtensionDetail(page, brokenRow, 'broken-one')
		await expect(brokenDetail.locator('[data-testid="extensions-plugin-error"]')).toContainText('not valid JSON')

		// The plugin never gets a second compiled-in-style row.
		await expect(page.locator('[data-testid="extensions-row"][data-extension-id="bookmark"]')).toHaveCount(0)
	} finally {
		await close()
	}
})

test('a URL pasted from another app lands as the claiming plugin object, not a note (goal 0251)', async () => {
	const { page, close } = await launchWithPlugins(6)
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		const board = page.getByTestId('atlas-board')
		await expect(board).toBeVisible()

		// The paste anchors at the pointer -- aim at open canvas first
		// (atlas-paste-convert.spec.ts's own cursor-position gesture).
		const spot = await findEmptyBoardRect(page, board, 300, 200)
		// eslint-disable-next-line no-restricted-syntax -- cursor-position-only gesture, not a checkable interaction (atlas-paste-convert.spec.ts's pasteText comment has the full reasoning)
		await page.mouse.move(spot.x + 20, spot.y + 20)
		await page.evaluate(() => {
			const dt = new DataTransfer()
			dt.setData('text/plain', 'https://example.com/some/page')
			window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
		})

		// The whole claims chain fires: manifest scan -> wiring's
		// enablement filter -> the Go recognizer -> a bookmark object
		// rendered by the plugin's own face, carrying the pasted URL.
		const face = page.locator('[data-testid="plugin-face-bookmark"]')
		await expect(face).toBeVisible()
		await expect(face.locator('[data-testid="bookmark-url-input"]')).toHaveValue('https://example.com/some/page')

		// And it landed as the claimed object, never the note fallback.
		await expect(page.locator('[data-testid="atlas-sticky-note"]')).toHaveCount(0)
	} finally {
		await close()
	}
})

test('the palette offers the plugin tool as a create command on the atlas surface', async () => {
	const { page, close } = await launchWithPlugins(8)
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		await expect(page.getByTestId('atlas-board')).toBeVisible()
		// Meta+/ is the palette's own binding on the atlas surface (⌘K
		// is jump-to-card there -- command-palette.spec.ts's own atlas
		// pattern).
		await page.keyboard.press('Meta+/')
		const dialog = page.getByRole('dialog', { name: 'Command palette' })
		await expect(dialog).toBeVisible()
		await dialog.getByRole('combobox').fill('Bookmark')
		// The plugin's atlas.create.<kind> command -- the same palette
		// parity every built-in tool's create command has.
		await expect(dialog.getByRole('option', { name: 'Bookmark', exact: true })).toBeVisible()
	} finally {
		await close()
	}
})

test('a plugin object placed before its plugin is removed stays visible, honest, and deletable', async () => {
	// Two servers over ONE data dir (the persistence.spec restart
	// pattern): place with the plugin installed, relaunch with an empty
	// plugins dir -- the object must render the fallback face, never
	// nothing (the 0249 "objects stay untouched" promise, made visible).
	const dir = mkdtempSync(path.join(tmpdir(), 'mill-plugins-e2e-orphan-'))
	const pluginsDir = path.join(dir, 'plugins')
	mkdirSync(pluginsDir, { recursive: true })
	cpSync(path.join(EXAMPLES_PLUGINS_DIR, 'mill-bookmark'), path.join(pluginsDir, 'mill-bookmark'), { recursive: true })
	const emptyPluginsDir = path.join(dir, 'plugins-empty')
	mkdirSync(emptyPluginsDir, { recursive: true })
	const spawnOpts = {
		port: RUNTIME_PLUGINS_SERVER_BASE_PORT + 12,
		mcpPort: RUNTIME_PLUGINS_MCP_BASE_PORT + 12,
		settingsPath: path.join(dir, 'settings.json'),
		executionDbPath: path.join(dir, 'exec.db'),
		backupDir: path.join(dir, 'backups'),
	}
	const browser = await chromium.launch()
	// Track every spawned server so a mid-test failure still stops them
	// in finally -- a server stopped only after its assertions leaks on
	// timeout, and the leaked port then fails the retry with a bind
	// error that masks the real failure.
	const servers: SpawnedServer[] = []
	try {
		const first = await spawnMillServer({ ...spawnOpts, extraEnv: { MILL_PLUGINS_DIR: pluginsDir } })
		servers.push(first)
		const page1 = await browser.newPage({ baseURL: first.baseURL })
		await page1.goto('/')
		await page1.getByRole('link', { name: 'Atlas' }).click()
		const board = page1.getByTestId('atlas-board')
		await expect(board).toBeVisible()
		await page1.locator('[data-testid="atlas-creation-tray"] button[aria-label="Bookmark"]').click()
		const spot = await findEmptyBoardRect(page1, board, 300, 200)
		const bb = await board.boundingBox()
		if (!bb) throw new Error('board has no bounding box')
		await board.click({ position: { x: spot.x - bb.x + 10, y: spot.y - bb.y + 10 } })
		await expect(page1.locator('[data-testid="plugin-face-bookmark"]')).toBeVisible()
		await page1.close()
		await first.stop()

		const second = await spawnMillServer({ ...spawnOpts, extraEnv: { MILL_PLUGINS_DIR: emptyPluginsDir } })
		servers.push(second)
		const page2 = await browser.newPage({ baseURL: second.baseURL })
		await page2.goto('/')
		await page2.getByRole('link', { name: 'Atlas' }).click()
		const face = page2.getByTestId('atlas-unknown-kind-face')
		await expect(face).toBeVisible()
		await expect(face).toContainText("Its extension isn't running")
		// Still a real, selectable object -- delete it through the
		// standard context-menu door (atlas-diagram-object.spec.ts's own
		// object-menu pattern: the shared context-menu testid + a plain
		// Delete text item, never an ARIA menuitem role).
		await face.click({ button: 'right' })
		const menu = page2.getByTestId('context-menu')
		await expect(menu).toBeVisible()
		await menu.getByText('Delete', { exact: true }).click()
		await expect(page2.getByTestId('atlas-unknown-kind-face')).toHaveCount(0)
	} finally {
		await browser.close()
		for (const s of servers) await s.stop().catch(() => {})
		rmSync(dir, { recursive: true, force: true })
	}
})

// The three plugin doors (goal 0252 S1), proven against the shipping
// mill-scribble artifact: a drag-shaped plugin tool rides the one
// gesture engine (a real pointer drag lands the plugin's own object,
// a stray armed click lands nothing), its declared styleFields render
// in the generic style picker and the picked value reaches the
// committed object, and its renderPreview overlay mounts during the
// drag.
test('a plugin drag tool draws through the gesture engine with its own style picker and preview (goal 0252 S1)', async () => {
	const { page, close } = await launchWithPlugins(6)
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		const board = page.getByTestId('atlas-board')
		await expect(board).toBeVisible()

		const scribbleBtn = page.locator('[data-testid="atlas-creation-tray"] button[aria-label="Scribble"]')
		await expect(scribbleBtn).toBeVisible()
		await scribbleBtn.click()

		// The generic style picker renders this tool's declared fields;
		// pick the second color so the commit provably reads the store,
		// not the default.
		const secondColor = page.locator('[data-testid="atlas-scribble-color-da3633"]')
		await expect(secondColor).toBeVisible()
		await secondColor.click()

		// A stray armed click never places (drag tools create only
		// through their own gesture).
		const spot = await findEmptyBoardRect(page, board, 300, 200)
		await clickBoardPoint(page, { x: spot.x + 20, y: spot.y + 20 })
		await expect(page.locator('[data-testid="plugin-face-scribble"]')).toHaveCount(0)

		// A real drag through the checked fixture helper; the preview
		// overlay must be live mid-drag (onArrived fires with the
		// button still down).
		await dragBetween(page, { x: spot.x + 20, y: spot.y + 20 }, { x: spot.x + 160, y: spot.y + 80 }, async () => {
			await expect(page.locator('[data-testid="atlas-scribble-plugin-preview"] svg')).toBeVisible()
		})

		const face = page.locator('[data-testid="plugin-face-scribble"]')
		await expect(face).toBeVisible()
		const stroke = face.locator('svg polyline')
		await expect(stroke).toBeVisible()
		await expect(stroke).toHaveAttribute('stroke', '#da3633')

		// Sticky: the tool stays armed after a stroke (the drawing-tool
		// convention) -- a second drag lands a second object.
		await dragBetween(page, { x: spot.x + 30, y: spot.y + 120 }, { x: spot.x + 130, y: spot.y + 160 })
		await expect(page.locator('[data-testid="plugin-face-scribble"]')).toHaveCount(2)
	} finally {
		await close()
	}
})
