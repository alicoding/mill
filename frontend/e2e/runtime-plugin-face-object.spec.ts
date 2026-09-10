// A framed OBJECT face joins the board (docs/goals/0380 S2): a canvas
// object whose kind declares an entry page and no tool draws its face
// in a sandboxed frame, the SAME PluginFrame + atlasActivation adapter
// goal 0349 S6 gave a framed tool's own face. The example proof is the
// bundled mill-bookmark plugin (examples/plugins/mill-bookmark),
// migrated off renderFace onto face.html/face.js this goal -- every
// launchWithPlugins caller already loads it (runtimePlugins.ts's
// SHARED_EXAMPLE_PLUGIN_IDS), so this spec needs no fixture plugin of
// its own.
//
// Shared runtime-plugins harness (offset 150, unclaimed): every object
// this file creates it also erases, so the harness's own per-test
// server teardown is the only cleanup that matters.
import { expect, test } from '@playwright/test'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { gotoAppReady } from './fixtures/appReady'
import { ATLAS_DEFAULT_SPACE_ID, createBoardObjectViaRPC } from './fixtures/atlasNativeDropEscapeHatch'
import { clickAtlasTrayTool } from './fixtures/atlasTray'
import { dragBetween, dragResizeHandle } from './fixtures/atlasBoardPointer'
import { waitForViewportStable } from './fixtures/animation'

const OFFSET = 150

function bookmarkNode(page: import('@playwright/test').Page) {
	return page.locator('[data-testid="atlas-board-object"][data-object-kind="bookmark"]')
}

async function openBoard(page: import('@playwright/test').Page) {
	await gotoAppReady(page)
	await page.getByRole('link', { name: 'Atlas' }).click()
	await expect(page.getByTestId('atlas-board')).toBeVisible()
}

// Lands one bookmark object, reloads so the board reads it back from
// the server, and selects it -- the face is inert behind the click
// shield until the object is selected (the shield contract every
// interactive face shares), which is what a person does first too.
async function landAndSelect(page: import('@playwright/test').Page) {
	await createBoardObjectViaRPC(page, 'bookmark', { url: 'https://example.com/board-gallery' }, { X: 0, Y: 480 }, ATLAS_DEFAULT_SPACE_ID)
	await openBoard(page)
	const node = bookmarkNode(page)
	await expect(node).toBeVisible()
	await waitForViewportStable(page.getByTestId('atlas-board'))
	const shield = node.getByTestId('atlas-object-click-shield')
	await shield.click()
	await expect(shield).toHaveCount(0)
	await expect(node).toHaveAttribute('data-activation', 'selected')
	return node
}

test('a bookmark object draws its face in a sandboxed frame: select, right-click menu, activate/deactivate, then erase', async () => {
	const { page, close } = await launchWithPlugins(OFFSET)
	try {
		await gotoAppReady(page)
		const node = await landAndSelect(page)

		// The face itself: a real iframe, under the object's own chrome --
		// never a same-DOM element the plugin drew.
		const frame = node.locator('iframe[data-testid="plugin-face-frame-bookmark"]')
		await expect(frame).toBeVisible()
		await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms')
		const face = page.frameLocator('iframe[data-testid="plugin-face-frame-bookmark"]')
		await expect(face.getByTestId('bookmark-title')).toHaveText('example.com')
		await expect(face.locator('body')).toHaveAttribute('data-active', 'false')

		// Right-click reaches the OBJECT's own menu off the chrome band --
		// never the frame's content, which a genuine cross-origin iframe
		// could never bubble a contextmenu event out of (the same band
		// door atlas-json-object.spec.ts's deleteViaContextMenu uses for a
		// content-capturing face).
		await node.locator('[data-testid="atlas-board-object-frame"]').click({ button: 'right' })
		const menu = page.getByTestId('context-menu')
		await expect(menu).toBeVisible()
		await expect(menu.getByText('Delete', { exact: true })).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(menu).toHaveCount(0)

		// Double-click activates: the page's own dblclick handler (bubbled
		// from the input, real user target) asks the host for editing, the
		// host answers face:activate, and the page marks its own body with
		// it -- the one thing a sandboxed page cannot observe about itself
		// otherwise.
		const urlInput = face.getByTestId('bookmark-url-input')
		await urlInput.dblclick()
		await expect(node).toHaveAttribute('data-activation', 'editing')
		await expect(face.locator('body')).toHaveAttribute('data-active', 'true')

		// Escape starts at the focused input, whose own keydown handler
		// keeps board shortcuts out of typing. That handler must hand
		// editing back before it stops propagation; a document-only
		// listener cannot observe this real path.
		await expect(urlInput).toBeFocused()
		await urlInput.press('Escape')
		await expect(node).toHaveAttribute('data-activation', 'selected')
		await expect(face.locator('body')).toHaveAttribute('data-active', 'false')

		// The eraser removes it exactly as it removes any other object --
		// no plugin capability needed, since the built-in tool owns hit-
		// testing entirely. Deselected first (a click on open canvas, back
		// to idle behind the shield): every other eraser proof in this
		// suite (atlas-eraser-laser.spec.ts) sweeps an UNSELECTED object
		// too, which is the shape a drag-erase gesture actually is --
		// something swept over in passing, never a thing already open.
		const board = page.getByTestId('atlas-board')
		await board.click({ position: { x: 20, y: 20 } })
		await expect(node).toHaveAttribute('data-activation', 'idle')
		await waitForViewportStable(board)
		const box = await node.boundingBox()
		if (!box) throw new Error('bookmark object has no bounding box')
		await clickAtlasTrayTool(page, 'atlas-tray-eraser')
		await dragBetween(
			page,
			{ x: box.x - 40, y: box.y + box.height / 2 },
			{ x: box.x + box.width + 40, y: box.y + box.height / 2 },
		)
		await expect(node).toHaveCount(0)
	} finally {
		await close()
	}
})

// Local-only (QUARANTINE.md's atlas-table-resize class: synthesized
// pointermove deltas coalesce on CI runners, producing zero growth) --
// the same carve-out atlas-image-tool.spec.ts's own resize case
// carries.
test('dragging a bookmark object\'s resize handle grows it live', async () => {
	test.skip(!!process.env.CI, 'drag synthesis coalesces on CI -- QUARANTINE.md atlas-table-resize')
	const { page, close } = await launchWithPlugins(OFFSET + 1)
	try {
		await gotoAppReady(page)
		const node = await landAndSelect(page)
		const before = await node.boundingBox()
		if (!before) throw new Error('bookmark object has no bounding box')

		const handle = page.locator('.react-flow__resize-control.handle.bottom.right')
		await expect(handle).toBeVisible()
		await dragResizeHandle(page, handle, 120, 80)

		await expect.poll(async () => (await node.boundingBox())?.width ?? 0).toBeGreaterThan(before.width + 80)
	} finally {
		await close()
	}
})
