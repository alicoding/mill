import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { launchWithPlugins, runFromPalette } from './fixtures/runtimePlugins'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { openPluginDetail } from './fixtures/settingsNav'

// The Request tester example plugin (goal 0291) and its secretRef
// door (goal 0281, ADR-0048), split from runtime-plugin-doors.spec.ts
// at the file-size convention. Dedicated server per test, offsets 24+.

// The Request tester example (goal 0291): a useful extension on
// nothing but the doors -- a work tab, any-host guarded fetch (every
// request asks, rules skipped), storage-backed history, a declared
// setting. Its Extensions row states the any-host reach declare-first.
test('the Request tester sends to a host you approve in Review, shows the response, and remembers the request across a reload', async () => {
	const http = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"pong":true}') })
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
	const port = (http.address() as AddressInfo).port
	const { page, close } = await launchWithPlugins(24)
	try {
		await page.goto('/')
		const detail = await openPluginDetail(page, 'mill-request-tester')
		await expect(detail.getByTestId('extensions-detail-reach')).toHaveText('Can reach any host you approve, one request at a time')

		await page.getByRole('link', { name: 'Atlas' }).click()
		await expect(page.getByTestId('atlas-board')).toBeVisible()
		await runFromPalette(page, 'Request tester')
		const view = page.getByTestId('plugin-view-mill-request-tester-tester')
		await expect(view).toBeVisible()
		await expect(view.getByTestId('tester-method')).toHaveValue('GET')
		await view.getByTestId('tester-url').fill(`http://127.0.0.1:${port}/ping`)
		await view.getByTestId('tester-send').click()
		await expect(view.getByTestId('tester-status')).toContainText('needs your approval')

		const reviewPage = await page.context().newPage()
		await reviewPage.goto('/')
		await reviewPage.getByRole('link', { name: 'Review' }).click()
		const parked = reviewPage.locator('[data-testid="review-guarded-action-item"]')
		await expect(parked).toBeVisible()
		await expect(parked.locator('[data-testid="review-guarded-action-source"]')).toContainText('plugin:mill-request-tester')
		await expect(parked).toContainText('did not declare')
		await parked.locator('[data-testid="review-guarded-action-approve"]').click()
		await expect(parked).toHaveCount(0)
		await reviewPage.close()

		await expect(view.getByTestId('tester-status')).toContainText('200')
		// The plugin asked Mill to draw the response (api.ui.renderOutput,
		// goal 0326): a JSON Content-Type opens as a tree, and Raw on the
		// same toolbar still holds the exact body.
		const response = view.getByTestId('tester-response')
		await expect(response.getByTestId('json-tree-leaf').filter({ hasText: 'pong' })).toContainText('true')
		await response.getByTestId('output-view-raw').click()
		await expect(response.getByTestId('plugin-output-mill-request-tester-raw')).toContainText('{"pong":true}')
		await expect(view.getByTestId('tester-history-item')).toHaveCount(1)

		// History is plugin storage: it survives a reload of the restored tab.
		await page.reload()
		await page.getByRole('tab', { name: /Request tester/ }).click()
		await expect(page.getByTestId('plugin-view-mill-request-tester-tester').getByTestId('tester-history-item')).toContainText(`GET http://127.0.0.1:${port}/ping → 200`)
	} finally {
		await close()
		await new Promise<void>((resolve) => http.close(() => resolve()))
	}
})

// The secretRef door (ADR-0048, goal 0281): the tester's Authorization
// setting is a vault picker; a request naming it parks in Review with
// the secret's title, the approved request carries the value Mill
// attached, and the response hands the plugin only a redaction.
test('a secretRef setting picks a vault entry; the request parks naming it, sends it host-side, and the value never comes back', async () => {
	let seenAuth = ''
	const http = createServer((req, res) => {
		seenAuth = String(req.headers.authorization ?? '')
		res.setHeader('Content-Type', 'application/json')
		res.setHeader('X-Echo', seenAuth)
		res.end(JSON.stringify({ auth: seenAuth }))
	})
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
	const port = (http.address() as AddressInfo).port
	const { page, close } = await launchWithPlugins(26)
	try {
		await page.goto('/')
		const SECRETS = 'github.com/alicoding/mill/internal/services/secretsvc.SecretService'
		await callBindingViaRPC(page, `${SECRETS}.SetupVault`, [])
		await callBindingViaRPC(page, `${SECRETS}.CreateSecret`, ['E2E API token', 'bot', 'tok-e2e-0281-value', '', '', ''])

		// The picker lists the vault by title and stores only the id.
		await page.reload()
		const detail = await openPluginDetail(page, 'mill-request-tester')
		const picker = detail.getByTestId('extension-setting-mill-request-tester-auth').getByTestId('secret-ref-picker')
		await expect(picker).toBeVisible()
		await picker.selectOption({ label: 'E2E API token' })
		await expect(picker.locator('option:checked')).toHaveText('E2E API token')
		const stored = await callBindingViaRPC<Record<string, Record<string, string>>>(page, 'github.com/alicoding/mill/internal/services/settingssvc.SettingsService.GetExtensionSettings', [])
		expect(stored['mill-request-tester'].auth).not.toContain('tok-e2e')

		await page.getByRole('link', { name: 'Atlas' }).click()
		await expect(page.getByTestId('atlas-board')).toBeVisible()
		await runFromPalette(page, 'Request tester')
		const view = page.getByTestId('plugin-view-mill-request-tester-tester')
		await expect(view.getByTestId('tester-auth')).toContainText('E2E API token')
		await view.getByTestId('tester-url').fill(`http://127.0.0.1:${port}/me`)
		await view.getByTestId('tester-send').click()
		await expect(view.getByTestId('tester-status')).toContainText('needs your approval')

		const reviewPage = await page.context().newPage()
		await reviewPage.goto('/')
		await reviewPage.getByRole('link', { name: 'Review' }).click()
		const parked = reviewPage.locator('[data-testid="review-guarded-action-item"]')
		await expect(parked).toBeVisible()
		await expect(parked).toContainText('uses secret')
		await expect(parked).toContainText('E2E API token')
		await expect(parked).not.toContainText('tok-e2e')
		await parked.locator('[data-testid="review-guarded-action-approve"]').click()
		await expect(parked).toHaveCount(0)
		await reviewPage.close()

		await expect(view.getByTestId('tester-status')).toContainText('200')
		expect(seenAuth).toBe('Bearer tok-e2e-0281-value')
		await expect(view.getByTestId('tester-response')).toContainText('[redacted]')
		await expect(view.getByTestId('tester-response')).not.toContainText('tok-e2e')
	} finally {
		await close()
		await new Promise<void>((resolve) => http.close(() => resolve()))
	}
})
