import { expect, test } from '@playwright/test'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { findEmptyBoardRect } from './fixtures/atlasEmptyRegion'
import { clickAtlasTrayTool } from './fixtures/atlasTray'

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
		await page.keyboard.press('Meta+/')
		const dialog = page.getByRole('dialog', { name: 'Command palette' })
		await expect(dialog).toBeVisible()
		await dialog.getByRole('combobox').fill('Say hello')
		await dialog.getByRole('option', { name: 'Say hello from the probe' }).click()
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
