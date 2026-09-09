// The Mind map example plugin (goal 0283): a VIEW over one note's
// headings on nothing but the public doors -- api.query for the note's
// text, api.on('contents:changed') to follow it, updatePayload for the
// reference. Dedicated server per test (launchWithPlugins), so the
// note and the map it shows are this test's own.
import { expect, test } from '@playwright/test'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { ATLAS_DEFAULT_SPACE_ID, createBoardObjectViaRPC } from './fixtures/atlasNativeDropEscapeHatch'
import { findEmptyBoardRect } from './fixtures/atlasEmptyRegion'
import { contextMenu } from './fixtures/contextMenu'
import { armToolFromMorePanel } from './fixtures/atlasTray'

const ATLAS = 'github.com/alicoding/mill/internal/services/atlassvc.AtlasService.'
const NOTE = ['Trip plan', '# Flights', '## Outbound', '## Return', '# Hotels', 'Plain text stays out of the map.', '```', '# not a heading', '```'].join('\n')

test('a mind map over a note shows its headings as a tree, follows edits, and reports a deleted note', async () => {
	const { page, close } = await launchWithPlugins(28)
	try {
		if (process.env.MILL_E2E_SHOT_MAP) await page.setViewportSize({ width: 1600, height: 1200 }) // screenshot review only: a zoom-1 close-up
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		await expect(page.getByTestId('atlas-board')).toBeVisible()

		// The note and the map that references it land through the same
		// RPCs a tray click goes through (the reference is the payload).
		const note = await callBindingViaRPC<{ ID: string }>(page, ATLAS + 'CreateNote', [NOTE, { X: 0, Y: 480 }, ATLAS_DEFAULT_SPACE_ID])
		await createBoardObjectViaRPC(page, 'mindmap', { noteId: note.ID }, { X: 420, Y: 480 }, ATLAS_DEFAULT_SPACE_ID)
		const face = page.locator('[data-testid="plugin-face-mindmap"]')
		const svg = face.getByTestId('mindmap-svg')
		await expect(svg).toBeVisible()
		// Root = the note's first line; headings nested by level; body
		// text and a fenced "heading" never become nodes.
		for (const label of ['Trip plan', 'Flights', 'Outbound', 'Return', 'Hotels']) await expect(svg).toContainText(label)
		await expect(svg).not.toContainText('Plain text')
		await expect(svg).not.toContainText('not a heading')

		// Editing the note reaches the map through the change event.
		await callBindingViaRPC(page, ATLAS + 'UpdateNoteText', [note.ID, NOTE + '\n# Cars'])
		await expect(svg).toContainText('Cars')
		if (process.env.MILL_E2E_SHOT_MAP) {
			const b = await page.locator('[data-testid="atlas-board-object"][data-object-kind="mindmap"]').boundingBox()
			if (b) await page.screenshot({ path: process.env.MILL_E2E_SHOT_MAP, clip: { x: Math.max(0, b.x - 20), y: Math.max(0, b.y - 20), width: b.width + 40, height: b.height + 40 } })
		}

		// Deleting the note leaves an honest notice and the picker.
		await callBindingViaRPC(page, ATLAS + 'DeleteNote', [note.ID])
		await expect(face.getByTestId('mindmap-notice')).toHaveText('The note this map showed is gone.')
		await expect(face.getByTestId('mindmap-note-picker')).toBeVisible()
	} finally {
		await close()
	}
})

test('inserting a fresh Mind map from the More panel shows its declared example at once, and the menu still switches to a real note', async () => {
	const { page, close } = await launchWithPlugins(30)
	try {
		await page.goto('/')
		await page.getByRole('link', { name: 'Atlas' }).click()
		const board = page.getByTestId('atlas-board')
		await expect(board).toBeVisible()
		await callBindingViaRPC(page, ATLAS + 'CreateNote', ['Reading list\n# Fiction\n# History', { X: 0, Y: 480 }, ATLAS_DEFAULT_SPACE_ID])

		await armToolFromMorePanel(page, 'Mind map')
		const spot = await findEmptyBoardRect(page, board, 300, 200)
		const bb = await board.boundingBox()
		if (!bb) throw new Error('board has no bounding box')
		await board.click({ position: { x: spot.x - bb.x + 10, y: spot.y - bb.y + 10 } })

		// goal 0411 S2: an empty-payload insert is materialized from the
		// plugin's OWN declared example before the first render -- the
		// SVG shows real content immediately, never the blank picker.
		const face = page.locator('[data-testid="plugin-face-mindmap"]')
		await expect(face).toBeVisible()
		const svg = face.getByTestId('mindmap-svg')
		await expect(svg).toBeVisible()
		await expect(svg).toContainText('Idea')
		await expect(svg).toContainText('Plan')
		await expect(svg).toContainText('Notes')
		await expect(face.getByTestId('mindmap-note-picker')).toHaveCount(0)
		if (process.env.MILL_E2E_SHOT) await page.screenshot({ path: process.env.MILL_E2E_SHOT })

		// The object's own payload carries the example's title (the
		// generic Payload.title search/reference convention) and a real
		// linked fixture note -- the same shape the gallery seed produces.
		const objects = await callBindingViaRPC<{ Kind: string; Payload: Record<string, string> }[]>(page, ATLAS + 'Objects', [])
		const object = objects.find((o) => o.Kind === 'mindmap')
		if (!object) throw new Error('no mindmap object found')
		expect(object.Payload.title).toBe('Mind map example')
		const notes = await callBindingViaRPC<{ ID: string; Text: string }[]>(page, ATLAS + 'Notes', [])
		const fixtureNote = notes.find((n) => n.ID === object.Payload.noteId)
		expect(fixtureNote?.Text).toContain('Mind map example')

		// The menu still offers switching to a note already on the board.
		const objectLocator = page.locator('[data-testid="atlas-board-object"][data-object-kind="mindmap"]')
		await objectLocator.click({ button: 'right' })
		const menu = contextMenu(page)
		await expect(menu).toBeVisible()
		await menu.getByText('Change source note…', { exact: true }).click()
		const picker = face.getByTestId('mindmap-note-picker')
		await expect(picker).toBeVisible()
		await expect(svg).toHaveCount(0)
		await picker.selectOption({ label: 'Reading list' })
		await expect(svg).toBeVisible()
		await expect(svg).toContainText('Fiction')
		await expect(svg).toContainText('History')
	} finally {
		await close()
	}
})
