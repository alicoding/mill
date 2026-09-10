import { expect, test } from '@playwright/test'
import { launchWithPlugins, runFromPalette } from './fixtures/runtimePlugins'
import { openConfigureKind } from './fixtures/configureNav'

// api.content.createList (goal 0310): a plugin creates a Configure List
// through the same guarded plane as its other writes; approved, the
// list stands in Configure with its declared columns and first rows.
// Split from runtime-plugin-doors.spec.ts at the file-size convention
// (architecture.md's 500-line limit); dedicated server, offset 69.
test('a plugin creates a List through the content door: approved in Review it appears in Configure with its columns and rows', async () => {
	const { page, close } = await launchWithPlugins(69, {
		extraPlugins: [{
			id: 'list-probe',
			manifest: { name: 'List probe', capabilities: ['write-content'] },
			main: `export function activate(api) {
	api.registerCommand({ id: 'list', label: 'Probe create a list', run: async () => {
		try {
			const r = await api.content.createList({ title: 'Probe vendors', columns: [{ name: 'Vendor' }, { name: 'Tier', type: 'text' }], rows: [{ Vendor: 'Acme', Tier: 'gold' }] })
			api.notify({ level: r.approved ? 'success' : 'warning', text: r.approved ? 'Wrote ' + r.id : 'Not allowed ' + r.ruleLabel })
		} catch (e) { api.notify({ level: 'error', text: 'Threw: ' + (e && e.message ? e.message : e) }) }
	} })
}
` }],
	})
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		await expect(page.getByTestId('atlas-board')).toBeVisible()
		await runFromPalette(page, 'Probe create a list')
		const reviewPage = await page.context().newPage()
		await reviewPage.goto('/')
		await reviewPage.getByRole('link', { name: 'Review' }).click()
		const row = reviewPage.locator('[data-testid="review-guarded-action-item"]')
		await expect(row).toContainText('Create a list: Probe vendors (2 columns, 1 rows)')
		await expect(row.locator('[data-testid="review-guarded-action-source"]')).toContainText('plugin:list-probe')
		await row.locator('[data-testid="review-guarded-action-approve"]').click()
		await expect(row).toHaveCount(0)
		await expect(page.locator('[data-testid^="notice-pushed-"]', { hasText: 'Wrote ' })).toBeVisible()
		await reviewPage.close()

		await page.getByRole('link', { name: 'Configure' }).click()
		await openConfigureKind(page, 'Lists')
		const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]', { has: page.getByText('Probe vendors', { exact: true }) })
		await expect(listRow).toBeVisible()
		await expect(listRow).toContainText('2 columns, 1 rows')
	} finally {
		await close()
	}
})
