// Two plugins claim pasted links (ADR-0051 slice 2, goal 0305): the
// converged paste-provider model -- the first claimant's object lands,
// the toast offers the other, and Settings > Extensions' "Pasted links
// become" sets which lands first. Dedicated server per test
// (launchWithPlugins with the clipper added beside Bookmark: the
// clipper stays out of the shared example set precisely because it
// claims the same gesture). Offsets 36/38 (the fixture's range map).
import { expect, test } from '@playwright/test'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { findEmptyBoardRect } from './fixtures/atlasEmptyRegion'
import { openExtensions } from './fixtures/settingsNav'

async function pasteLink(page: import('@playwright/test').Page, url: string) {
	const board = page.getByTestId('atlas-board')
	await expect(board).toBeVisible()
	const spot = await findEmptyBoardRect(page, board, 300, 200)
	// eslint-disable-next-line no-restricted-syntax -- cursor-position-only gesture, not a checkable interaction (atlas-paste-convert.spec.ts's pasteText comment has the full reasoning)
	await page.mouse.move(spot.x + 20, spot.y + 20)
	await page.evaluate((link) => {
		const dt = new DataTransfer()
		dt.setData('text/plain', link)
		window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
	}, url)
}

test('a link two plugins claim lands as the first claimant, and the toast re-types it as the other in place', async () => {
	const { page, close } = await launchWithPlugins(36, { extraExamples: ['mill-clipper'] })
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		await pasteLink(page, 'https://example.com/some/page')

		// Id order decides with no preference: mill-bookmark before
		// mill-clipper, so the bookmark lands -- the same result the
		// single-claimant spec pins.
		const bookmark = page.locator('[data-testid="plugin-face-bookmark"]')
		await expect(bookmark).toBeVisible()
		await expect(bookmark.locator('[data-testid="bookmark-url-input"]')).toHaveValue('https://example.com/some/page')

		// The toast names what landed and offers the alternative by its
		// tool label.
		const toast = page.getByTestId('atlas-quiet-toast')
		await expect(toast).toContainText('Pasted as Bookmark')
		const offer = page.getByTestId('atlas-quiet-toast-action')
		await expect(offer).toHaveText('Paste as Web clipper instead')
		await offer.click()

		// Same object, new kind: the clipper's face now shows the pasted
		// address, and no bookmark face remains.
		const clip = page.locator('[data-testid="plugin-face-clip"]')
		await expect(clip).toBeVisible()
		await expect(clip.locator('[data-testid="clip-url-input"]')).toHaveValue('https://example.com/some/page')
		await expect(bookmark).toHaveCount(0)
		await expect(page.locator('[data-testid="atlas-sticky-note"]')).toHaveCount(0)
	} finally {
		await close()
	}
})

test('Settings > Extensions chooses which claimant pasted links become', async () => {
	const { page, close } = await launchWithPlugins(38, { extraExamples: ['mill-clipper'] })
	try {
		await page.goto('/')
		await openExtensions(page)
		const section = page.locator('[data-testid="extensions-installed-plugins"]')
		await section.scrollIntoViewIfNeeded()
		const select = section.getByTestId('extensions-link-paste-select')
		await expect(select).toBeVisible()
		// Both claimants, by tool label, the id-order default selected.
		await expect(select).toHaveValue('bookmark')
		await expect(select.locator('option')).toHaveText(['Bookmark', 'Web clipper'])
		await select.selectOption('clip')
		await expect(select).toHaveValue('clip')

		await page.getByRole('link', { name: 'Atlas' }).click()
		await pasteLink(page, 'https://example.com/other')
		const clip = page.locator('[data-testid="plugin-face-clip"]')
		await expect(clip).toBeVisible()
		await expect(clip.locator('[data-testid="clip-url-input"]')).toHaveValue('https://example.com/other')
		await expect(page.locator('[data-testid="plugin-face-bookmark"]')).toHaveCount(0)
		// The offer now points the other way.
		await expect(page.getByTestId('atlas-quiet-toast-action')).toHaveText('Paste as Bookmark instead')

		// The preference survives a reload (it lives in Mill's settings,
		// not the page).
		await page.reload()
		await openExtensions(page)
		await expect(page.getByTestId('extensions-link-paste-select')).toHaveValue('clip')
	} finally {
		await close()
	}
})
