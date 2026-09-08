import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { launchWithPlugins, runFromPalette } from './fixtures/runtimePlugins'

// The SDK helpers goal 0386 S1 added -- fetchJSON, storage.pushList/
// getList, convert.markdownToHtml, formatDate -- each already unit
// tested against its own module (pluginFetchJSON.test.ts,
// pluginStorage.test.ts, pluginDateFormat.test.ts); this proves the
// WIRING end to end through the real guarded doors and the real
// activation-frame bridge (this probe declares no canvas object, so
// its main.js activates framed, docs/goals/0375 S1b). Split from
// runtime-plugin-doors.spec.ts (at the file-size convention), own
// offset (80) clear of every other runtime-plugin spec's (60 and 100
// unclaimed too, per fixtures/runtimePlugins.ts's own o/o-20/o+20
// safety rule).

test('api.fetchJSON parses an approved JSON response and never throws for a denied one', async () => {
	const http = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"pong":true}') })
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
	const port = (http.address() as AddressInfo).port
	const host = `127.0.0.1:${port}`
	const { page, close } = await launchWithPlugins(80, {
		extraPlugins: [{
			id: 'sdk-helpers-probe',
			manifest: { name: 'SDK helpers probe', capabilities: ['fetch'], contributes: { network: [{ host }] } },
			main: `export function activate(api) {
	api.registerCommand({ id: 'fetchJSON', label: 'Probe fetchJSON', run: async () => {
		try {
			const r = await api.fetchJSON('http://${host}/pong')
			api.notify({ level: r.ok ? 'success' : 'warning', text: r.ok ? 'fetchJSON ok: ' + JSON.stringify(r.data) : 'fetchJSON not ok: ' + r.errorText })
		} catch (e) { api.notify({ level: 'error', text: 'Threw: ' + (e && e.message ? e.message : e) }) }
	} })
	api.registerCommand({ id: 'helpers', label: 'Probe storage list, convert and date', run: async () => {
		try {
			await api.storage.pushList('history', { at: 1 }, { max: 5 })
			await api.storage.pushList('history', { at: 2 }, { max: 5 })
			const list = await api.storage.getList('history')
			const html = await api.convert.markdownToHtml('# Title')
			const date = api.formatDate('2026-01-01T00:00:00Z', 'short')
			// The em-dash-for-an-unparseable-timestamp path is already unit
			// tested (pluginDateFormat.test.ts); this only proves the wiring
			// answers something for a real date.
			api.notify({ level: 'success', text: 'list:' + list.length + ' html:' + html.includes('<h1>Title</h1>') + ' date-ok:' + (date.length > 0) })
		} catch (e) { api.notify({ level: 'error', text: 'Threw: ' + (e && e.message ? e.message : e) }) }
	} })
}
` }],
	})
	try {
		await page.goto('/')
		await expect(page.getByRole('link', { name: 'Atlas' })).toBeVisible()

		// fetchJSON goes through the same guarded network door as fetch:
		// it parks in Review before answering anything.
		await runFromPalette(page, 'Probe fetchJSON')
		const reviewPage = await page.context().newPage()
		await reviewPage.goto('/')
		await reviewPage.getByRole('link', { name: 'Review' }).click()
		const row = reviewPage.locator('[data-testid="review-guarded-action-item"]')
		await expect(row).toBeVisible()
		await expect(row.locator('[data-testid="review-guarded-action-source"]')).toContainText('plugin:sdk-helpers-probe')
		await row.locator('[data-testid="review-guarded-action-approve"]').click()
		await expect(row).toHaveCount(0)
		await reviewPage.close()
		await expect(page.locator('[data-testid^="notice-pushed-"]', { hasText: 'fetchJSON ok: {"pong":true}' })).toBeVisible()

		// storage.pushList/getList, convert.markdownToHtml and formatDate
		// need no capability -- one command, one notice.
		await runFromPalette(page, 'Probe storage list, convert and date')
		const helpers = page.locator('[data-testid^="notice-pushed-"]', { hasText: 'list:2 html:true date-ok:true' })
		await expect(helpers).toBeVisible()
	} finally {
		await close()
		await new Promise<void>((resolve) => http.close(() => resolve()))
	}
})
