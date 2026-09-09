// The review notice's actionable target (docs/goals/0420): the list
// marks what waits (a pill on the row, a pinned "Needs review" group),
// the notice's Review action deep-links onto it, and an upgraded
// install never puts an unmodified plugin back into review just
// because the lock predates the ContentHash/CodeHash split (#806).
// Dedicated server per test (launchWithPlugins), its own port pair
// (RUNTIME_PLUGIN_REVIEW_*): every case seeds settings-plugin-lock/
// settings-allowed-plugins directly, global plugin-trust state.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { openExtensionDetail, openExtensions, pluginRow } from './fixtures/settingsNav'

// fixtures/runtimePlugins.ts's own SHARED_EXAMPLE_PLUGIN_IDS (not
// exported): every launchWithPlugins caller gets these five copied in
// beside whatever extraPlugins it declares.
const SHARED_EXAMPLE_PLUGIN_IDS = ['mill-bookmark', 'mill-scribble', 'mill-index', 'mill-request-tester', 'mill-markmap']

const OLD_FORMAT_MANIFEST = { name: 'Old format', capabilities: ['open-url'] }
const OLD_FORMAT_MAIN = `export function activate(api) {
	api.registerCommand({ id: 'noop', label: 'No-op', run: () => {} })
}
`

// Replicates pluginsvc's ContentHash (pluginservice_hash.go): every
// hashed file's relative path and bytes, sorted by path, each framed by
// a null byte -- the exact bytes launchWithPlugins' extraPlugins writes
// to disk, so this test can seed a lock entry recorded at the value a
// real pre-#806 install would carry.
function pluginContentHash(id: string, manifest: Record<string, unknown>, main: string): string {
	const manifestJSON = JSON.stringify({ id, version: '1.0.0', ...manifest })
	const files = [
		{ rel: 'main.js', body: Buffer.from(main, 'utf8') },
		{ rel: 'manifest.json', body: Buffer.from(manifestJSON, 'utf8') },
	].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
	const hash = createHash('sha256')
	for (const f of files) {
		hash.update(f.rel)
		hash.update(Buffer.from([0]))
		hash.update(f.body)
		hash.update(Buffer.from([0]))
	}
	return `sha256-${hash.digest('hex')}`
}

test('an upgraded install migrates a pre-CodeHash lock entry: the plugin loads without review', async () => {
	const contentHash = pluginContentHash('old-format', OLD_FORMAT_MANIFEST, OLD_FORMAT_MAIN)
	const { page, close } = await launchWithPlugins(0, {
		ports: { server: 12380, mcp: 12400 },
		extraPlugins: [{ id: 'old-format', manifest: OLD_FORMAT_MANIFEST, main: OLD_FORMAT_MAIN }],
		settings: {
			// Bypassing the grandfathering path (settings-allowed-plugins is
			// already set) means every OTHER installed plugin needs its own
			// explicit allow too, or it reads 'unallowed' and pollutes this
			// test's own "no review" assertion.
			'settings-allowed-plugins': JSON.stringify(['old-format', ...SHARED_EXAMPLE_PLUGIN_IDS]),
			'settings-plugin-lock': JSON.stringify({ 'old-format': { version: '1.0.0', hash: contentHash } }),
		},
	})
	try {
		await page.goto('/')
		await openExtensions(page)
		const row = pluginRow(page, 'old-format')
		await expect(row).toBeVisible()
		// Migrated onto CodeHash at boot: it runs like any other allowed
		// plugin, no review pill, a working toggle.
		await expect(row.getByTestId('extensions-row-needs-review')).toHaveCount(0)
		await expect(row.getByTestId('extensions-plugin-toggle')).toBeVisible()
		await expect(page.getByTestId('notice-review-plugins')).toHaveCount(0)
		const detail = await openExtensionDetail(page, row, 'old-format')
		await expect(detail.getByTestId('extensions-plugin-review')).toHaveCount(0)
	} finally {
		await close()
	}
})

test('a plugin whose files change after it was allowed: the pill, the pinned group and the notice all appear, Allow again clears them together', async () => {
	const { page, pluginsDir, close } = await launchWithPlugins(2, { ports: { server: 12380, mcp: 12400 } })
	try {
		await page.goto('/')
		await openExtensions(page)
		// Grandfathered at boot with its hash recorded; no review yet.
		await expect(page.getByTestId('notice-review-plugins')).toHaveCount(0)
		await expect(pluginRow(page, 'mill-bookmark').getByTestId('extensions-row-needs-review')).toHaveCount(0)

		// An edit after consent is drift the lock catches on the next boot.
		writeFileSync(path.join(pluginsDir, 'mill-bookmark', 'main.js'), '// edited after consent\n' + readFileSync(path.join(pluginsDir, 'mill-bookmark', 'main.js'), 'utf8'))
		await page.reload()

		// The notice names it and the badge/pill/group all read the same count.
		const review = page.getByTestId('notice-review-plugins')
		await expect(review).toBeVisible()
		await expect(page.getByTestId('notice-plugin-review')).toContainText('1 extension needs your review')
		await expect(page.getByTestId('extensions-review-count')).toContainText('1')

		await openExtensions(page)
		const group = page.getByTestId('extensions-needs-review-group')
		await expect(group).toContainText('Needs review (1)')
		const row = pluginRow(page, 'mill-bookmark')
		await expect(row.getByTestId('extensions-row-needs-review')).toContainText('Needs review')
		await expect(row.getByTestId('extensions-plugin-toggle')).toHaveCount(0)

		const detail = await openExtensionDetail(page, row, 'mill-bookmark')
		await expect(detail.getByTestId('extensions-plugin-review')).toContainText('Its files changed since you allowed it')
		const allowAgain = detail.getByTestId('extensions-plugin-allow')
		await expect(allowAgain).toContainText('Allow again')
		// changed offers Remove beside Allow again (Decision 3).
		await expect(detail.getByTestId('extensions-plugin-remove')).toBeVisible()
		await allowAgain.click()
		await expect(detail.getByTestId('extensions-plugin-review')).toContainText('Allowed. Reload to load it.')
		await expect(detail.getByTestId('extensions-plugin-remove')).toHaveCount(0)

		// A decision plus the detail's own Reload clears every indicator
		// together, in the page: the notice and the nav badge follow the
		// live count, never a restart.
		await detail.getByTestId('extensions-plugin-reload').click()
		await expect(page.getByTestId('notice-plugin-review')).toHaveCount(0)
		await expect(page.getByTestId('extensions-review-count')).toHaveCount(0)
		await expect(page.getByTestId('extensions-needs-review-group')).toHaveCount(0)
		// And the next boot has nothing to re-toast.
		await page.reload()
		await expect(page.getByTestId('notice-plugin-review')).toHaveCount(0)
		await expect(page.getByTestId('extensions-review-count')).toHaveCount(0)
		await openExtensions(page)
		await expect(page.getByTestId('extensions-needs-review-group')).toHaveCount(0)
		await expect(pluginRow(page, 'mill-bookmark').getByTestId('extensions-row-needs-review')).toHaveCount(0)
		await expect(pluginRow(page, 'mill-bookmark').getByTestId('extensions-plugin-toggle')).toBeVisible()
	} finally {
		await close()
	}
})

test('Remove on a changed plugin runs the existing uninstall door: the confirm names it, and it leaves the list', async () => {
	const { page, pluginsDir, close } = await launchWithPlugins(4, { ports: { server: 12380, mcp: 12400 } })
	try {
		await page.goto('/')
		await openExtensions(page)
		writeFileSync(path.join(pluginsDir, 'mill-bookmark', 'main.js'), '// edited after consent\n' + readFileSync(path.join(pluginsDir, 'mill-bookmark', 'main.js'), 'utf8'))
		await page.reload()
		await openExtensions(page)

		const row = pluginRow(page, 'mill-bookmark')
		const detail = await openExtensionDetail(page, row, 'mill-bookmark')
		await detail.getByTestId('extensions-plugin-remove').click()
		const confirm = page.getByRole('alertdialog')
		await expect(confirm).toContainText('Bookmark')
		await confirm.getByRole('button', { name: 'Remove' }).click()

		await expect(pluginRow(page, 'mill-bookmark')).toHaveCount(0)
		await expect(page.getByTestId('extensions-needs-review-group')).toHaveCount(0)
		// Removing the one plugin that waited clears the notice and the
		// nav badge with it, in the page.
		await expect(page.getByTestId('notice-plugin-review')).toHaveCount(0)
		await expect(page.getByTestId('extensions-review-count')).toHaveCount(0)
	} finally {
		await close()
	}
})
