// The document Content-Security-Policy (goal 0310, threat model T9):
// every served document carries it except the iframed vendored
// viewers, and markup a plugin injects cannot run script -- an inline
// handler and a script element both stay dead. Dedicated server for
// the injection case (launchWithPlugins with a fixture plugin, offset
// 68); the header case reads plain responses.
import { expect, test } from '@playwright/test'
import { launchWithPlugins } from './fixtures/runtimePlugins'

const INJECTOR = {
	id: 'injector',
	manifest: { name: 'Injector', contributes: { canvasObjects: [{ kind: 'inject' }] } },
	main: `export function activate(api) {
	api.registerCanvasObject({
		kind: 'inject', label: 'Injector', icon: '💉', source: 'board-local', editRoute: 'none', defaultPayload: {},
		renderFace(el) {
			el.innerHTML = '<img src="x" onerror="window.__millPwned = 1"><span data-testid="inject-face">face</span>'
			const s = document.createElement('script')
			s.textContent = 'window.__millPwned2 = 1'
			el.append(s)
		},
	})
}
`,
}

test('the app document carries the policy; the vendored viewers do not', async () => {
	const { page, close } = await launchWithPlugins(68, { extraPlugins: [INJECTOR] })
	try {
		const home = await page.request.get('/')
		const policy = home.headers()['content-security-policy'] ?? ''
		expect(policy).toContain("script-src 'self'")
		expect(policy).toContain("object-src 'none'")
		expect(policy).not.toContain('unsafe-eval')
		const viewer = await page.request.get('/vendor/pdfjs/web/viewer.html')
		expect(viewer.headers()['content-security-policy'] ?? '').toBe('')

		// Markup a plugin injects cannot run script in Mill's document.
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		await page.locator('[data-testid="atlas-creation-tray"] button[aria-label="Injector"]').click()
		const board = page.getByTestId('atlas-board')
		const box = (await board.boundingBox())!
		// eslint-disable-next-line no-restricted-syntax -- an armed tool's placement click lands on open canvas, where there is no element to check (goal 0184's own exception)
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
		await expect(page.getByTestId('inject-face')).toBeVisible()
		await page.waitForTimeout(500) // the onerror would fire within the image's failed load; nothing observable marks its absence
		expect(await page.evaluate(() => [(window as unknown as { __millPwned?: number }).__millPwned, (window as unknown as { __millPwned2?: number }).__millPwned2])).toEqual([undefined, undefined])
	} finally {
		await close()
	}
})
