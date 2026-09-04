// The plugin trust posture (ADR-0051 §4, goal 0305 slice 3): a plugin
// installed after the run gate waits for the user's review (nothing of
// it runs), an administrator's allow-list blocks everything off it, and
// the audit export is one JSON document. Dedicated server per test
// (launchWithPlugins). Offsets 42/44/46 (the fixture's range map).
import { expect, test } from '@playwright/test'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { openExtensionDetail, openSettings, pluginRow } from './fixtures/settingsNav'

const LATE_PLUGIN = `export function activate(api) {
	api.registerCanvasObject({ kind: 'late', label: 'Late arrival', icon: '🕰️', source: 'board-local', editRoute: 'none', defaultPayload: {}, renderFace(el) { el.textContent = 'late' } })
}
`

test('a plugin installed after boot waits for review: the boot notice names it, nothing of it runs, Allow then reload loads it', async () => {
	const { page, pluginsDir, close } = await launchWithPlugins(42)
	try {
		// First boot with the gate: the plugins already present are
		// grandfathered -- they load exactly as before, no review asked.
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		await expect(page.locator('[data-testid="atlas-creation-tray"] button[aria-label="Bookmark"]')).toBeVisible()
		await expect(page.getByTestId('notice-review-plugins')).toHaveCount(0)

		// A new plugin arrives while Mill runs; the next boot gates it.
		mkdirSync(path.join(pluginsDir, 'late-arrival'))
		writeFileSync(path.join(pluginsDir, 'late-arrival', 'manifest.json'), JSON.stringify({ id: 'late-arrival', name: 'Late arrival', version: '1.0.0', capabilities: ['open-url'], contributes: { canvasObjects: [{ kind: 'late' }], network: [{ host: 'example.com' }] } }))
		writeFileSync(path.join(pluginsDir, 'late-arrival', 'main.js'), LATE_PLUGIN)
		await page.reload()
		await page.getByRole('link', { name: 'Atlas' }).click()
		await expect(page.locator('[data-testid="atlas-creation-tray"] button[aria-label="Bookmark"]')).toBeVisible()
		// Nothing of it ran: no tray tool.
		await expect(page.locator('[data-testid="atlas-creation-tray"] button[aria-label="Late arrival"]')).toHaveCount(0)
		// The boot notice names the count and opens the Extensions section.
		const review = page.getByTestId('notice-review-plugins')
		await expect(review).toBeVisible()
		await expect(page.locator('[data-testid^="notice-pushed-"]').first()).toContainText('1 new plugin is waiting for you to allow it')
		await review.click()

		const row = pluginRow(page, 'late-arrival')
		await expect(row).toBeVisible()
		await expect(row.getByTestId('extensions-plugin-toggle')).toHaveCount(0)
		// The reach summary reads before anything runs (goal 0321: in
		// the detail pane the row opens).
		const detail = await openExtensionDetail(page, row, 'late-arrival')
		await expect(detail).toContainText('Can request: open-url')
		await expect(detail.getByTestId('extensions-detail-reach')).toContainText('example.com')
		await expect(detail.getByTestId('extensions-plugin-review')).toContainText('Not running yet')
		await detail.getByTestId('extensions-plugin-allow').click()
		await expect(detail.getByTestId('extensions-plugin-review')).toContainText('Allowed. Reload to load it.')

		await page.reload()
		await page.getByRole('link', { name: 'Atlas' }).click()
		await expect(page.locator('[data-testid="atlas-creation-tray"] button[aria-label="Late arrival"]')).toBeVisible()
		await expect(page.getByTestId('notice-review-plugins')).toHaveCount(0)
	} finally {
		await close()
	}
})

test('an administrator allow-list in the settings file blocks every plugin off it and is reported read-only', async () => {
	const { page, close } = await launchWithPlugins(44, { settings: { 'settings-plugin-allowlist': JSON.stringify(['mill-bookmark']) } })
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		const tray = page.locator('[data-testid="atlas-creation-tray"]')
		await expect(tray.locator('button[aria-label="Bookmark"]')).toBeVisible()
		await expect(tray.locator('button[aria-label="Scribble"]')).toHaveCount(0)

		await openSettings(page, 'extensions')
		const section = page.locator('[data-testid="extensions-installed-plugins"]')
		await section.scrollIntoViewIfNeeded()
		await expect(section.getByTestId('extensions-allowlist')).toContainText("Only plugins on this Mill's allow-list can run: mill-bookmark")
		// A blocked plugin's row offers no switch at all; the reason
		// reads in its detail pane (goal 0321).
		const scribble = pluginRow(page, 'mill-scribble')
		await expect(scribble.getByTestId('extensions-plugin-toggle')).toHaveCount(0)
		const scribbleDetail = await openExtensionDetail(page, scribble, 'mill-scribble')
		await expect(scribbleDetail.getByTestId('extensions-plugin-blocked')).toContainText('Not on this Mill')
		await expect(scribbleDetail.getByTestId('extensions-plugin-allow')).toHaveCount(0)
		// The built-in Drawing plugin is exempt from the list.
		const drawing = pluginRow(page, 'mill-drawing')
		await expect(drawing.getByTestId('extensions-plugin-toggle')).toBeVisible()
		const drawingDetail = await openExtensionDetail(page, drawing, 'mill-drawing')
		await expect(drawingDetail.getByTestId('extensions-plugin-blocked')).toHaveCount(0)
	} finally {
		await close()
	}
})

test('Export plugin audit saves one JSON document naming every plugin, its reach, and its trust state', async () => {
	const { page, close } = await launchWithPlugins(46)
	try {
		await page.goto('/')
		await openSettings(page, 'extensions')
		const section = page.locator('[data-testid="extensions-installed-plugins"]')
		await section.scrollIntoViewIfNeeded()
		const download = page.waitForEvent('download')
		await section.getByTestId('extensions-export-audit').click()
		const file = await download
		expect(file.suggestedFilename()).toMatch(/^mill-plugin-audit-\d{4}-\d{2}-\d{2}\.json$/)
		const body = JSON.parse(await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'))) as {
			schema: string
			plugins: { id: string; capabilities: string[]; claimsLinks: boolean; allowed: boolean; enabled: boolean; builtin: boolean }[]
			guardedActions: unknown[]
			secretAccess: unknown[]
			guardedActionsWindow: string
		}
		expect(body.schema).toBe('mill-plugin-audit/1')
		const bookmark = body.plugins.find((p) => p.id === 'mill-bookmark')
		expect(bookmark).toMatchObject({ capabilities: ['open-url'], claimsLinks: true, allowed: true, enabled: true, builtin: false })
		expect(body.plugins.find((p) => p.id === 'mill-drawing')).toMatchObject({ builtin: true, allowed: true })
		expect(Array.isArray(body.guardedActions)).toBe(true)
		expect(Array.isArray(body.secretAccess)).toBe(true)
		expect(body.guardedActionsWindow).toBe('24h0m0s')
	} finally {
		await close()
	}
})

test('a plugin whose files change after it was allowed stops running until allowed again (the lock)', async () => {
	const { page, pluginsDir, close } = await launchWithPlugins(56)
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		const bookmark = page.locator('[data-testid="atlas-creation-tray"] button[aria-label="Bookmark"]')
		await expect(bookmark).toBeVisible()

		// Grandfathered at boot with its hash recorded; an edit after that
		// is drift the lock catches on the next boot.
		writeFileSync(path.join(pluginsDir, 'mill-bookmark', 'main.js'), '// edited after consent\n' + readFileSync(path.join(pluginsDir, 'mill-bookmark', 'main.js'), 'utf8'))
		await page.reload()
		await page.getByRole('link', { name: 'Atlas' }).click()
		await expect(page.locator('[data-testid="atlas-creation-tray"] button[aria-label="Scribble"]')).toBeVisible()
		await expect(bookmark).toHaveCount(0)

		await openSettings(page, 'extensions')
		const row = pluginRow(page, 'mill-bookmark')
		await expect(row.getByTestId('extensions-plugin-toggle')).toHaveCount(0)
		const detail = await openExtensionDetail(page, row, 'mill-bookmark')
		await expect(detail.getByTestId('extensions-plugin-review')).toContainText('Its files changed since you allowed it')

		// The reload button is offered exactly here -- an edit after
		// consent is when it is reached for -- and it refuses through the
		// same lock, in one readable sentence (goal 0341: this notice
		// used to render a literal double hyphen).
		await detail.getByTestId('extensions-plugin-reload').click()
		const refusal = page.locator('[data-testid^="notice-pushed-"]', {
			hasText: 'its files changed since you allowed it. Allow it again on its row',
		})
		await expect(refusal).toBeVisible()
		await expect(page.locator('[data-testid^="notice-pushed-"]')).not.toContainText(' -- ')

		await detail.getByTestId('extensions-plugin-allow').click()
		await expect(detail.getByTestId('extensions-plugin-review')).toContainText('Allowed. Reload to load it.')

		await page.reload()
		await page.getByRole('link', { name: 'Atlas' }).click()
		await expect(bookmark).toBeVisible()
	} finally {
		await close()
	}
})

test('with signing keys pinned, an unsigned plugin cannot run and the bar says so', async () => {
	// A real minisign public key (the format the policy accepts); no
	// example ships a signature for it, so every plugin is unsigned.
	const key = 'RWTV8L06+shYI4jnCBc0V3XvcBqz2y0Q2Zc4tQ5qmJ2tbiuvkgpzEUrb'
	const { page, close } = await launchWithPlugins(58, { settings: { 'settings-plugin-signing-keys': JSON.stringify([key]) } })
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		const tray = page.locator('[data-testid="atlas-creation-tray"]')
		await expect(tray).toBeVisible()
		await expect(tray.locator('button[aria-label="Bookmark"]')).toHaveCount(0)
		await openSettings(page, 'extensions')
		const section = page.locator('[data-testid="extensions-installed-plugins"]')
		await section.scrollIntoViewIfNeeded()
		await expect(section.getByTestId('extensions-allowlist')).toContainText('Only plugins signed by the 1 key this Mill trusts can run.')
		const row = pluginRow(page, 'mill-bookmark')
		await expect(row.getByTestId('extensions-plugin-toggle')).toHaveCount(0)
		const detail = await openExtensionDetail(page, row, 'mill-bookmark')
		await expect(detail.getByTestId('extensions-plugin-unsigned')).toContainText('Not signed by a key this Mill trusts')
		// The built-in Drawing plugin is exempt from the signing policy.
		await expect(pluginRow(page, 'mill-drawing').getByTestId('extensions-plugin-toggle')).toBeVisible()
	} finally {
		await close()
	}
})
