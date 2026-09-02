import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { findEmptyBoardRect } from './fixtures/atlasEmptyRegion'
import { clickAtlasTrayTool } from './fixtures/atlasTray'

// runFromPalette -- the one way these tests fire a plugin command: the
// palette's own binding, the command by its registered label.
async function runFromPalette(page: import('@playwright/test').Page, label: string) {
	await page.keyboard.press('Meta+/')
	const dialog = page.getByRole('dialog', { name: 'Command palette' })
	await expect(dialog).toBeVisible()
	await dialog.getByRole('combobox').fill(label)
	await dialog.getByRole('option', { name: label }).click()
}

// The platform DOORS a runtime plugin gets beyond rendering its own
// object (goal 0261's ratified order): declared settings (0258),
// notify (0277), query + change events (0278) -- each proven against
// the shipping example plugins or a minimal fixture plugin. Split from
// runtime-plugins.spec.ts (which keeps the object contract itself) at
// the file-size convention; dedicated server per test, offsets 10+.

// A plugin's declared settings (manifest contributes.settings, goal
// 0258 slice 1) render host-side in its own Installed-plugins row --
// an enum as a select, a string as a text field -- and reach plugin
// code through api.settings: the bookmark's title style flips live on
// every open face (onChange), and the value survives a reload.
test('a plugin declares settings in its manifest; Mill renders them, stores them, and serves them back to the plugin', async () => {
	const { page, close } = await launchWithPlugins(10)
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
		const title = face.locator('[data-testid="bookmark-title"]')
		// The string setting's default shows before any address.
		await expect(title).toHaveText('Bookmark')
		await face.locator('[data-testid="bookmark-url-input"]').click()
		await page.keyboard.type('example.com/docs')
		await page.keyboard.press('Enter')
		await expect(title).toHaveText('example.com')

		// Settings: the row renders both declared controls.
		await page.getByRole('link', { name: 'Settings' }).click()
		const row = page.locator('[data-testid="extensions-plugin-row"][data-plugin-id="mill-bookmark"]')
		await row.scrollIntoViewIfNeeded()
		const settings = row.locator('[data-testid="extensions-plugin-settings"]')
		await expect(settings).toBeVisible()
		const styleSelect = settings.locator('[data-testid="extension-setting-mill-bookmark-titleStyle"] select')
		await expect(styleSelect).toHaveValue('hostname')
		await styleSelect.selectOption('address')
		const placeholder = settings.locator('[data-testid="extension-setting-mill-bookmark-placeholderTitle"] input')
		await expect(placeholder).toHaveValue('Bookmark')
		await placeholder.fill('Link')
		await page.keyboard.press('Enter')

		// Back on the board the plugin has re-read both values.
		await page.getByRole('link', { name: 'Atlas' }).click()
		await expect(title).toHaveText('https://example.com/docs')
		// A second bookmark on its own empty rect (the first face would
		// swallow a click inside it) shows the new placeholder title.
		await page.locator('[data-testid="atlas-creation-tray"] button[aria-label="Bookmark"]').click()
		const spot2 = await findEmptyBoardRect(page, board, 300, 200)
		await board.click({ position: { x: spot2.x - bb.x + 10, y: spot2.y - bb.y + 10 } })
		await expect(page.locator('[data-testid="bookmark-title"]', { hasText: 'Link' })).toBeVisible()

		// Persisted centrally: a reload serves the same values.
		await page.reload()
		await page.getByRole('link', { name: 'Atlas' }).click()
		await expect(page.locator('[data-testid="bookmark-title"]', { hasText: 'https://example.com/docs' })).toBeVisible()
	} finally {
		await close()
	}
})

// api.notify (goal 0277): a plugin's notice renders in Mill's own
// footer pill labelled with the plugin's name, a warning stays until
// dismissed, and the dismiss clears it.
test('a plugin notice renders in the app notice pill with the plugin named, and dismisses', async () => {
	const { page, close } = await launchWithPlugins(12, { withNotifier: true })
	try {
		await page.goto('/')
		// The shell must be mounted before the palette shortcut can land.
		await expect(page.getByRole('link', { name: 'Atlas' })).toBeVisible()
		await runFromPalette(page, 'Say hello from the probe')
		const notice = page.locator('[data-testid^="notice-pushed-"]', { hasText: 'Hello from the probe.' })
		await expect(notice).toBeVisible()
		await expect(notice).toHaveAttribute('data-notice-level', 'warning')
		await expect(notice.getByTestId('notice-source')).toHaveText('Notify probe')
		await notice.getByTestId('notice-dismiss').click()
		await expect(notice).toHaveCount(0)
	} finally {
		await close()
	}
})

// api.query + api.on (goal 0278), through the Board index example: the
// index face lists the board by kind with display names -- a note by
// its first line -- and re-renders on the change event when a note is
// added and when it is deleted, with no reload in between.
test('the Board index plugin lists notes by first line and stays current through the change event', async () => {
	const { page, close } = await launchWithPlugins(14)
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		const board = page.getByTestId('atlas-board')
		await expect(board).toBeVisible()
		await page.locator('[data-testid="atlas-creation-tray"] button[aria-label="Board index"]').click()
		const spot = await findEmptyBoardRect(page, board, 300, 200)
		const bb = await board.boundingBox()
		if (!bb) throw new Error('board has no bounding box')
		await board.click({ position: { x: spot.x - bb.x + 10, y: spot.y - bb.y + 10 } })
		const face = page.locator('[data-testid="index-face"]')
		await expect(face).toBeVisible()
		// The seeded board has cards; the index itself is listed too.
		await expect(face.getByTestId('index-kind-card')).toBeVisible()
		await expect(face.getByTestId('index-kind-index')).toHaveText('Index · 1')
		await expect(face.getByTestId('index-kind-note')).toHaveCount(0)

		// Add a note: its first line appears under Note without a reload.
		// Deselect the index first (a selected object changes what a
		// board click means), then arm the note tool from the tray.
		await page.keyboard.press('Escape')
		await clickAtlasTrayTool(page, 'atlas-tray-note')
		const noteSpot = await findEmptyBoardRect(page, board, 300, 200)
		await board.click({ position: { x: noteSpot.x - bb.x + 10, y: noteSpot.y - bb.y + 10 } })
		const sticky = page.getByTestId('atlas-sticky-note')
		await expect(sticky).toBeVisible()
		await expect
			.poll(() => page.evaluate(() => document.activeElement?.getAttribute('contenteditable') === 'true'))
			.toBe(true)
		await page.keyboard.type('Call the bank', { delay: 20 })
		await page.keyboard.press('Enter')
		await page.keyboard.type('tomorrow', { delay: 20 })
		// Leaving the editor by clicking the board commits the note
		// (Escape on a never-saved note discards it).
		const blurSpot = await findEmptyBoardRect(page, board, 120, 80)
		await board.click({ position: { x: blurSpot.x - bb.x + 5, y: blurSpot.y - bb.y + 5 } })
		await expect(sticky).toBeVisible()
		await expect(face.getByTestId('index-kind-note')).toHaveText('Note · 1')
		await expect(face.locator('[data-testid="index-row"][data-kind="note"]')).toHaveText('Call the bank')

		// Delete the note: the row leaves the same way.
		await sticky.click()
		await page.keyboard.press('Delete')
		await expect(sticky).toHaveCount(0)
		await expect(face.getByTestId('index-kind-note')).toHaveCount(0)
	} finally {
		await close()
	}
})

// api.fetch (goal 0288): a declared host reaches the guardrail (ask by
// default -> parks in Review with the plugin as source -> approve ->
// the response reaches the plugin); an undeclared host is refused
// before any rule runs. The target is a throwaway local HTTP server
// this test owns -- Mill's constraint that no outbound call happens
// without the user configuring it holds even inside the proof.
test('a plugin fetch is guarded: a declared host parks in Review and returns the response on approval; an undeclared host is refused outright', async () => {
	const http = createServer((_req, res) => { res.setHeader('Content-Type', 'text/plain'); res.end('pong from the probe target') })
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
	const port = (http.address() as AddressInfo).port
	const host = `127.0.0.1:${port}`
	const { page, close } = await launchWithPlugins(16, {
		extraPlugins: [{
			id: 'fetch-probe',
			manifest: { name: 'Fetch probe', capabilities: ['fetch'], contributes: { network: [{ host }] } },
			main: `export function activate(api) {
	api.registerCommand({ id: 'ok', label: 'Probe fetch declared', run: async () => {
		try {
			const r = await api.fetch('http://${host}/ping')
			api.notify({ level: r.approved ? 'success' : 'warning', text: r.approved ? 'Got ' + r.status + ': ' + r.body : 'Not allowed ' + r.ruleLabel, action: undefined })
		} catch (e) { api.notify({ level: 'error', text: 'Threw: ' + (e && e.message ? e.message : e) }) }
	} })
	api.registerCommand({ id: 'bad', label: 'Probe fetch undeclared', run: async () => {
		try { await api.fetch('https://example.com/'); api.notify({ level: 'error', text: 'Undeclared host went through' }) }
		catch (e) { api.notify({ level: 'warning', text: 'Refused: ' + (e && e.message ? e.message : e) }) }
	} })
}
` }],
	})
	try {
		await page.goto('/')
		await expect(page.getByRole('link', { name: 'Atlas' })).toBeVisible()

		// Undeclared host: refused before the guardrail -- nothing parks.
		await runFromPalette(page, 'Probe fetch undeclared')
		const refused = page.locator('[data-testid^="notice-pushed-"]', { hasText: 'Refused:' })
		await expect(refused).toBeVisible()
		await expect(refused).toContainText('contributes.network')
		await refused.getByTestId('notice-dismiss').click()

		// Declared host: parks in Review (ask by default), approved from a
		// second tab so the asking plugin stays mounted and gets the answer.
		await runFromPalette(page, 'Probe fetch declared')
		const reviewPage = await page.context().newPage()
		await reviewPage.goto('/')
		await reviewPage.getByRole('link', { name: 'Review' }).click()
		const row = reviewPage.locator('[data-testid="review-guarded-action-item"]')
		await expect(row).toBeVisible()
		await expect(row.locator('[data-testid="review-guarded-action-source"]')).toContainText('plugin:fetch-probe')
		await expect(row).toContainText(host)
		await row.locator('[data-testid="review-guarded-action-approve"]').click()
		await expect(row).toHaveCount(0)
		const got = page.locator('[data-testid^="notice-pushed-"]', { hasText: 'Got 200' })
		await expect(got).toBeVisible()
		await expect(got).toContainText('pong from the probe target')
		await reviewPage.close()
	} finally {
		await close()
		await new Promise<void>((resolve) => http.close(() => resolve()))
	}
})

// api.content (goal 0289): a plugin's note creation parks in Review
// with the plugin as source and, approved, lands on the board -- which
// the Board index example (api.query + api.on) then lists by its first
// line without a reload. A plugin without the capability is refused
// before any rule runs.
test('a plugin content write is guarded: approved in Review it lands on the board and the index lists it; without the capability it is refused outright', async () => {
	const { page, close } = await launchWithPlugins(18, {
		extraPlugins: [
			{
				id: 'writer-probe',
				manifest: { name: 'Writer probe', capabilities: ['write-content'] },
				main: `export function activate(api) {
	api.registerCommand({ id: 'note', label: 'Probe write a note', run: async () => {
		try {
			const r = await api.content.createNote({ text: 'Written by the probe' })
			api.notify({ level: r.approved ? 'success' : 'warning', text: r.approved ? 'Wrote ' + r.id : 'Not allowed ' + r.ruleLabel })
		} catch (e) { api.notify({ level: 'error', text: 'Threw: ' + (e && e.message ? e.message : e) }) }
	} })
}
` },
			{
				id: 'reader-probe',
				manifest: { name: 'Reader probe' },
				main: `export function activate(api) {
	api.registerCommand({ id: 'note', label: 'Probe write without capability', run: async () => {
		try { await api.content.createNote({ text: 'nope' }); api.notify({ level: 'error', text: 'Undeclared write went through' }) }
		catch (e) { api.notify({ level: 'warning', text: 'Refused: ' + (e && e.message ? e.message : e) }) }
	} })
}
` },
		],
	})
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		const board = page.getByTestId('atlas-board')
		await expect(board).toBeVisible()
		// The Board index example is on the board so the write's landing
		// is observed through the platform's own read door.
		await page.locator('[data-testid="atlas-creation-tray"] button[aria-label="Board index"]').click()
		const spot = await findEmptyBoardRect(page, board, 300, 200)
		const bb = await board.boundingBox()
		if (!bb) throw new Error('board has no bounding box')
		await board.click({ position: { x: spot.x - bb.x + 10, y: spot.y - bb.y + 10 } })
		const face = page.locator('[data-testid="index-face"]')
		await expect(face).toBeVisible()
		await expect(face.getByTestId('index-kind-note')).toHaveCount(0)
		await page.keyboard.press('Escape')


		await runFromPalette(page, 'Probe write without capability')
		const refused = page.locator('[data-testid^="notice-pushed-"]', { hasText: 'Refused:' })
		await expect(refused).toContainText('write-content')
		await refused.getByTestId('notice-dismiss').click()

		await runFromPalette(page, 'Probe write a note')
		const reviewPage = await page.context().newPage()
		await reviewPage.goto('/')
		await reviewPage.getByRole('link', { name: 'Review' }).click()
		const row = reviewPage.locator('[data-testid="review-guarded-action-item"]')
		await expect(row).toBeVisible()
		await expect(row.locator('[data-testid="review-guarded-action-source"]')).toContainText('plugin:writer-probe')
		await expect(row).toContainText('Create a note: Written by the probe')
		await row.locator('[data-testid="review-guarded-action-approve"]').click()
		await expect(row).toHaveCount(0)
		await expect(page.locator('[data-testid^="notice-pushed-"]', { hasText: 'Wrote ' })).toBeVisible()
		await expect(face.getByTestId('index-kind-note')).toHaveText('Note · 1')
		await expect(face.locator('[data-testid="index-row"][data-kind="note"]')).toHaveText('Written by the probe')
		await expect(page.getByTestId('atlas-sticky-note')).toBeVisible()
		await reviewPage.close()
	} finally {
		await close()
	}
})
