// The Bruno collection example plugin (goal 0308): a file-source object
// mirroring a collection's bruno.json; the face names the collection
// from the mirrored file. Dedicated server (launchWithPlugins with the
// example added).
import { expect, test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { waitForViewportStable } from './fixtures/animation'
import { armToolFromMorePanel } from './fixtures/atlasTray'

const GUARDRAIL = 'github.com/alicoding/mill/internal/services/guardrailsvc.GuardrailService.'
import { findEmptyBoardRect } from './fixtures/atlasEmptyRegion'

const COLLECTION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bruno-collection', 'bruno.json')

test('a Bruno collection object reads its bruno.json and names the collection', async () => {
	const { page, close } = await launchWithPlugins(34, { extraExamples: ['mill-bruno'] })
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		const board = page.getByTestId('atlas-board')
		await expect(board).toBeVisible()
		await armToolFromMorePanel(page, 'Bruno collection')
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

		// goal 0310: the requests come from the files door (a read-class
		// listing of the collection folder) ...
		await expect(face.getByTestId('bruno-requests')).toContainText('ping')
		// ... and "Open in Bruno" asks through the open-app door: the
		// action parks in Review under the plugin's own name, and a
		// denial reaches the face.
		// The taller face can reach under the board's corner controls at the
		// tray's landing spot (the occluded-click class): frame it first.
		await page.getByRole('button', { name: 'Fit View' }).click()
		await waitForViewportStable(board)
		await face.getByTestId('bruno-open').click()
		await expect(face.getByTestId('bruno-open-status')).toHaveText('Asking…')
		await expect.poll(async () => (await callBindingViaRPC<{ ID: string; Kind: string }[]>(page, GUARDRAIL + 'PendingGuardedActions', [])).filter((a) => a.Kind === 'open-app').length).toBe(1)
		const pending = (await callBindingViaRPC<{ ID: string; Kind: string }[]>(page, GUARDRAIL + 'PendingGuardedActions', [])).find((a) => a.Kind === 'open-app')!
		await callBindingViaRPC(page, GUARDRAIL + 'ResolveGuardedAction', [pending.ID, false])
		await expect(face.getByTestId('bruno-open-status')).toContainText('Not allowed')
	} finally {
		await close()
	}
})
