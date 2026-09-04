import { expect, test } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { openExtensionDetail, openSettings, pluginRow } from './fixtures/settingsNav'

// Uninstalling a plugin (goal 0321): the action lives behind the
// detail pane's … menu, never beside the enable toggle, and it is
// CONFIRMED before anything leaves disk. Dedicated server (its own
// copied plugins dir), because the test takes a folder off disk --
// the shared pool's own plugins dir must stay intact.
//
// Server mode has no desktop Trash to reach, so the folder lands in a
// `.trash` sibling (internal/adapters/filetrash) -- asserted on disk
// here, which is the property the real Trash provides too: removal is
// recoverable, never a delete.

test('The detail pane offers Reload and, behind its menu, a confirmed Remove that trashes the folder', async () => {
	const { page, pluginsDir, close } = await launchWithPlugins(70)
	try {
		await page.goto('/')
		await openSettings(page, 'extensions')

		const row = pluginRow(page, 'mill-bookmark')
		// Remove is NEVER on the row -- only identity and the switch.
		await expect(row.getByTestId('extensions-detail-remove')).toHaveCount(0)

		const detail = await openExtensionDetail(page, row, 'mill-bookmark')
		await expect(detail.getByTestId('extensions-plugin-reload')).toBeVisible()
		// What it adds, read from the manifest and the live registry.
		const adds = detail.getByTestId('extensions-detail-adds')
		await expect(adds).toContainText('Canvas objects: bookmark')
		// The host's own Reload is not something the plugin adds.
		await expect(adds).toContainText('Commands: Bookmark')
		await expect(adds).not.toContainText('Reload Bookmark')
		// Where it came from, verbatim.
		await expect(detail.getByTestId('extensions-detail-provenance')).toContainText(path.join(pluginsDir, 'mill-bookmark'))

		// Cancel keeps it: the sheet closes, the row stays, the folder
		// is untouched. The menu item renders in the overlay's own
		// portal, outside the pane's subtree.
		await detail.getByTestId('extensions-detail-menu').click()
		await page.getByTestId('extensions-detail-remove').click()
		await expect(page.getByText('Remove Bookmark?')).toBeVisible()
		await page.getByRole('button', { name: 'Cancel' }).click()
		await expect(page.getByText('Remove Bookmark?')).toHaveCount(0)
		await expect(row).toBeVisible()
		expect(existsSync(path.join(pluginsDir, 'mill-bookmark'))).toBe(true)

		// Remove takes it off the list and out of the folder.
		await detail.getByTestId('extensions-detail-menu').click()
		await page.getByTestId('extensions-detail-remove').click()
		await expect(page.getByText('Remove Bookmark?')).toBeVisible()
		await page.getByRole('button', { name: 'Remove', exact: true }).click()

		await expect(pluginRow(page, 'mill-bookmark')).toHaveCount(0)
		await expect(page.getByTestId('extensions-detail')).toHaveCount(0)
		expect(existsSync(path.join(pluginsDir, 'mill-bookmark'))).toBe(false)

		// Recoverable, not deleted: the folder is in the trash sibling.
		const trashed = readdirSync(path.join(pluginsDir, '.trash'))
		expect(trashed.some((name) => name.startsWith('mill-bookmark-'))).toBe(true)
	} finally {
		await close()
	}
})

// A plugin that ships INSIDE Mill has no folder of the user's to
// trash, so it is never offered -- the command's own enabled()
// predicate, rendered honestly rather than a button that fails.
test('A built-in plugin offers no Remove at all', async () => {
	const { page, close } = await launchWithPlugins(72)
	try {
		await page.goto('/')
		await openSettings(page, 'extensions')
		const detail = await openExtensionDetail(page, pluginRow(page, 'mill-drawing'), 'mill-drawing')
		await expect(detail.getByTestId('extensions-detail-menu')).toHaveCount(0)
	} finally {
		await close()
	}
})
