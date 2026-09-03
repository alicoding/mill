// The Bruno collection example plugin (goal 0308): a file-source object
// mirroring a collection's bruno.json; the face names the collection
// from the mirrored file. Dedicated server (launchWithPlugins with the
// example added).
import { expect, test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { findEmptyBoardRect } from './fixtures/atlasEmptyRegion'

const COLLECTION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bruno-collection', 'bruno.json')

test('a Bruno collection object reads its bruno.json and names the collection', async () => {
	const { page, close } = await launchWithPlugins(34, { extraExamples: ['mill-bruno'] })
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		const board = page.getByTestId('atlas-board')
		await expect(board).toBeVisible()
		await page.locator('[data-testid="atlas-creation-tray"] button[aria-label="Bruno collection"]').click()
		const spot = await findEmptyBoardRect(page, board, 300, 200)
		const bb = await board.boundingBox()
		if (!bb) throw new Error('board has no bounding box')
		await board.click({ position: { x: spot.x - bb.x + 10, y: spot.y - bb.y + 10 } })
		const face = page.locator('[data-testid="plugin-face-bruno-collection"]')
		await expect(face).toBeVisible()
		await expect(face.getByTestId('bruno-meta')).toContainText('Enter the path')
		await face.getByTestId('bruno-path-input').click()
		await face.getByTestId('bruno-path-input').fill(COLLECTION)
		await page.keyboard.press('Enter')
		await expect(face.getByTestId('bruno-title')).toHaveText('🐶 Steam Gazette API')
		await expect(face.getByTestId('bruno-meta')).toContainText('Example: Run a Bruno collection')
	} finally {
		await close()
	}
})
