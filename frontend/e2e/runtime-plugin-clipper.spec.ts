// The Web clipper example plugin (goal 0282): a page becomes a note on
// the public doors alone -- the guarded fetch (parks in Review), the
// vendored Readability, the convert door, the guarded note write
// (parks in Review). Dedicated server per test (launchWithPlugins with
// the clipper added: it is not in the shared example set). The page is
// served by a throwaway local server this test owns.
import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { findEmptyBoardRect } from './fixtures/atlasEmptyRegion'
import { armToolFromMorePanel } from './fixtures/atlasTray'

const ARTICLE = `<!doctype html><html><head><title>Why kettles whistle</title></head><body>
<nav><a href="/">Home</a> <a href="/about">About us</a> <a href="/login">Log in</a></nav>
<header><h1>The Steam Gazette</h1><p>Menu · Search · Subscribe</p></header>
<article>
<h1>Why kettles whistle</h1>
<p>A kettle whistles because steam forced through a narrow opening sets up a vibration, much like blowing across a bottle. The pitch rises as the flow rate climbs, which is why the note changes as the water comes to a rolling boil.</p>
<p>The first real study of the effect came from two Cambridge engineers who filmed the vortices leaving the spout. Their model predicts the frequency from the opening's width and the steam's speed, and it holds for spouts of every shape they tried.</p>
<p>Whistling kettles fell out of fashion with electric models, but the physics still governs pipe organs, tea urns, and the hiss of a pressure cooker.</p>
</article>
<footer><p>Newsletter signup · Privacy policy · © The Steam Gazette</p></footer>
</body></html>`

// Approves the parked action whose row carries hasText; the next
// parked action (the write follows the fetch at once) may already be
// queued behind it, so only that row's disappearance is asserted.
async function approveInReview(page: import('@playwright/test').Page, source: string, hasText: string) {
	const reviewPage = await page.context().newPage()
	await reviewPage.goto('/')
	await reviewPage.getByRole('link', { name: 'Review' }).click()
	const row = reviewPage.locator('[data-testid="review-guarded-action-item"]').filter({ hasText })
	await expect(row).toBeVisible()
	await expect(row.locator('[data-testid="review-guarded-action-source"]')).toContainText(source)
	await row.locator('[data-testid="review-guarded-action-approve"]').click()
	await expect(row).toHaveCount(0)
	await reviewPage.close()
}

test('a clip fetches the page (approved in Review), keeps the article and not the chrome, and saves it as a note ending with the source', async () => {
	const http = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(ARTICLE) })
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
	const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/kettles`
	const { page, close } = await launchWithPlugins(32, { extraExamples: ['mill-clipper'] })
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		const board = page.getByTestId('atlas-board')
		await expect(board).toBeVisible()

		await armToolFromMorePanel(page, 'Web clipper')
		const spot = await findEmptyBoardRect(page, board, 300, 200)
		const bb = await board.boundingBox()
		if (!bb) throw new Error('board has no bounding box')
		await board.click({ position: { x: spot.x - bb.x + 10, y: spot.y - bb.y + 10 } })
		const face = page.locator('[data-testid="plugin-face-clip"]')
		await expect(face).toBeVisible()
		await face.getByTestId('clip-url-input').click()
		await face.getByTestId('clip-url-input').fill(url)
		await page.keyboard.press('Enter')
		await face.getByTestId('clip-run').click()

		// The fetch parks in Review with the plugin as source.
		await expect(face.getByTestId('clip-status')).toContainText('Asking')
		await approveInReview(page, 'plugin:mill-clipper', '127.0.0.1')
		// So does the note write.
		// The approval's answer travels back through the bound call and
		// the fetch itself before the face moves on -- a longer wait.
		await expect(face.getByTestId('clip-status')).toContainText('Saving', { timeout: 20_000 })
		await approveInReview(page, 'plugin:mill-clipper', 'note')
		await expect(face.getByTestId('clip-status')).toHaveText('Clipped → Why kettles whistle')

		// The note: the article as markdown, none of the page's chrome,
		// the source last.
		const notes = await callBindingViaRPC<{ payload?: Record<string, string>; Payload?: Record<string, string>; title?: string; Title?: string }[]>(page, 'github.com/alicoding/mill/internal/services/atlassvc.AtlasService.ListContents', ['note', ''])
		const clipped = notes.map((n) => (n.Payload ?? n.payload ?? {}).text ?? '').find((t) => t.includes('Why kettles whistle'))
		expect(clipped).toBeTruthy()
		expect(clipped).toMatch(/^# Why kettles whistle\n/)
		expect(clipped).toContain('A kettle whistles because steam')
		expect(clipped).toContain('pipe organs')
		expect(clipped).not.toContain('Privacy policy')
		expect(clipped).not.toContain('Log in')
		expect(clipped).not.toContain('Subscribe')
		expect(clipped?.trimEnd().endsWith('Source: ' + url)).toBe(true)
		if (process.env.MILL_E2E_SHOT) await page.screenshot({ path: process.env.MILL_E2E_SHOT })
	} finally {
		await close()
		await new Promise<void>((resolve) => http.close(() => resolve()))
	}
})
