// Plugin faces in frames (goal 0349 S6): a canvas object whose manifest
// names an entry page draws its board face in a sandboxed frame inside
// the object's box. The chrome around it -- band, click shield, hover
// ring, resize -- stays the host's; the object's data reaches the page
// as its context and comes back through the bridge's object doors; a
// page that throws takes only its own frame down.
//
// Dedicated server pair (RUNTIME_PLUGIN_FACE_FRAME_*): the last test
// measures thirty framed faces on one board and prints the numbers.
import { expect, test } from '@playwright/test'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { RUNTIME_PLUGIN_FACE_FRAME_SERVER_BASE_PORT, RUNTIME_PLUGIN_FACE_FRAME_MCP_BASE_PORT } from './fixtures/serverPorts'
import { gotoAppReady } from './fixtures/appReady'
import { ATLAS_DEFAULT_SPACE_ID, createBoardObjectViaRPC } from './fixtures/atlasNativeDropEscapeHatch'
import { wheelAt } from './fixtures/pointer'

const PORTS = { server: RUNTIME_PLUGIN_FACE_FRAME_SERVER_BASE_PORT, mcp: RUNTIME_PLUGIN_FACE_FRAME_MCP_BASE_PORT }

const FACE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Framed note</title></head>
<body>
  <div data-testid="face-text"></div>
  <button type="button" id="bump" data-testid="face-bump">Bump</button>
  <script src="face.js"></script>
</body></html>`

const FACE_JS = `const mill = window.acquireMillApi()
const text = document.querySelector('[data-testid="face-text"]')
const show = () => { text.textContent = String((mill.context.object && mill.context.object.Payload.text) || '') }
show()
mill.on('ctx', show)
document.getElementById('bump').addEventListener('click', () => {
  void mill.call('object.updatePayload', { text: mill.context.object.Payload.text + '!' })
})
`

const THROWER_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Framed thrower</title></head>
<body><div data-testid="thrower-body">up</div><script src="throw.js"></script></body></html>`

const FRAMED_FACE = {
	id: 'framed-face',
	manifest: {
		name: 'Framed face',
		contributes: {
			canvasObjects: [
				{ kind: 'framed-note', entry: 'face.html' },
				{ kind: 'framed-thrower', entry: 'thrower.html' },
			],
		},
	},
	main: `export function activate(api) {
	api.registerCanvasObject({ kind: 'framed-note', label: 'Framed note', icon: 'square', source: 'board-local', editRoute: 'inline', defaultPayload: { text: 'hello' } })
	api.registerCanvasObject({ kind: 'framed-thrower', label: 'Framed thrower', icon: 'zap', source: 'board-local', editRoute: 'none' })
}
`,
	files: {
		'face.html': FACE_HTML,
		'face.js': FACE_JS,
		'thrower.html': THROWER_HTML,
		'throw.js': `throw new Error('the face broke on purpose')`,
	},
}

function objectNode(page: import('@playwright/test').Page, kind: string) {
	return page.locator(`[data-testid="atlas-board-object"][data-object-kind="${kind}"]`)
}

// The landing board, opened the way a person opens it.
async function openBoard(page: import('@playwright/test').Page) {
	await gotoAppReady(page)
	await page.getByRole('link', { name: 'Atlas' }).click()
	await expect(page.getByTestId('atlas-board')).toBeVisible()
}

test('a framed face renders its page inside a sandboxed frame, under the host chrome, and writes back through the object door', async () => {
	const { page, close } = await launchWithPlugins(0, { ports: PORTS, extraPlugins: [FRAMED_FACE] })
	try {
		await gotoAppReady(page)
		// Parked far outside the seeded rows (the atlas-arrange.spec.ts
		// pattern): a spot this distant can never sit under a seeded
		// card, so the hover's hit test reaches only this object.
		await createBoardObjectViaRPC(page, 'framed-note', { text: 'hello' }, { X: 4000, Y: 4000 }, ATLAS_DEFAULT_SPACE_ID)
		await openBoard(page)

		const node = objectNode(page, 'framed-note')
		await expect(node).toBeVisible()
		const frame = node.locator('iframe[data-testid="plugin-face-frame-framed-note"]')
		await expect(frame).toBeVisible()
		await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms')
		await expect(frame).toHaveAttribute('title', 'Framed note')
		const face = page.frameLocator('iframe[data-testid="plugin-face-frame-framed-note"]')
		await expect(face.getByTestId('face-text')).toHaveText('hello')

		// The chrome is the host's: the band and the idle click shield are
		// siblings of the frame in Mill's own document, never inside it.
		await expect(node.getByTestId('atlas-board-object-frame')).toBeVisible()
		await expect(node.getByTestId('atlas-object-click-shield')).toHaveCount(1)
		await node.hover({ timeout: 10000 })
		await expect.poll(async () => node.evaluate((el) => getComputedStyle(el).boxShadow), { timeout: 10000 }).not.toBe('none')

		// The first click selects the object (the shield takes it); the
		// page is live from then on, and its write comes back as context.
		await node.getByTestId('atlas-object-click-shield').click()
		await expect(node.getByTestId('atlas-object-click-shield')).toHaveCount(0)
		await expect(node).toHaveAttribute('data-activation', 'selected')
		// escape hatch: a pointer click cannot reach the button -- the frame
		// sits under the canvas's CSS scale transform, where Playwright's
		// coordinate mapping into subframes lands off-target at board zoom
		// levels (the same class atlas-seeded-board-objects.spec.ts names on
		// the seeded PDF viewer's link); the real click handler and the
		// write-back behind it are what this press proves.
		await face.getByTestId('face-bump').evaluate((b) => (b as HTMLButtonElement).click())
		await expect(face.getByTestId('face-text')).toHaveText('hello!')
	} finally {
		await close()
	}
})

test('a face page that throws takes only its own frame down; the board stays usable', async () => {
	const { page, close } = await launchWithPlugins(2, { ports: PORTS, extraPlugins: [FRAMED_FACE] })
	try {
		await gotoAppReady(page)
		await createBoardObjectViaRPC(page, 'framed-thrower', {}, { X: 160, Y: 160 }, ATLAS_DEFAULT_SPACE_ID)
		await openBoard(page)
		const node = objectNode(page, 'framed-thrower')
		await expect(node).toBeVisible()
		await expect(page.frameLocator('iframe[data-testid="plugin-face-frame-framed-thrower"]').getByTestId('thrower-body')).toHaveText('up')

		// The board around it still takes new objects and draws them.
		await createBoardObjectViaRPC(page, 'framed-note', { text: 'still here' }, { X: 520, Y: 160 }, ATLAS_DEFAULT_SPACE_ID)
		await expect(page.frameLocator('iframe[data-testid="plugin-face-frame-framed-note"]').getByTestId('face-text')).toHaveText('still here')
		await expect(page.getByTestId('atlas-board')).toBeVisible()
	} finally {
		await close()
	}
})

test('thirty framed faces on one board: time to interactive and pan frame rate, printed', async () => {
	const { page, close } = await launchWithPlugins(4, { ports: PORTS, extraPlugins: [FRAMED_FACE] })
	try {
		await gotoAppReady(page)
		for (let i = 0; i < 30; i++) {
			await createBoardObjectViaRPC(page, 'framed-note', { text: `face ${i}` }, { X: 120 + (i % 6) * 260, Y: 120 + Math.floor(i / 6) * 220 }, ATLAS_DEFAULT_SPACE_ID)
		}
		const started = Date.now()
		await openBoard(page)
		const frames = page.locator('iframe[data-testid="plugin-face-frame-framed-note"]')
		await expect(frames).toHaveCount(30) // count: fixture-owned
		for (let i = 0; i < 30; i++) {
			await expect(page.frameLocator('iframe[data-testid="plugin-face-frame-framed-note"]').nth(i).getByTestId('face-text')).toHaveText(`face ${i}`)
		}
		const timeToInteractiveMs = Date.now() - started

		// Frame rate while the board pans under the wheel: a sampler counts
		// animation frames for a second while wheel input lands on the
		// board.
		const board = page.getByTestId('atlas-board')
		const sampler = page.evaluate(() => new Promise<number>((resolve) => {
			let frames = 0
			const start = performance.now()
			const tick = () => {
				frames++
				if (performance.now() - start < 1000) requestAnimationFrame(tick)
				else resolve(frames)
			}
			requestAnimationFrame(tick)
		}))
		for (let i = 0; i < 8; i++) {
			await wheelAt(page, board, 0, 120)
			await page.waitForTimeout(60) // a wheel cadence a person produces, so the sampler measures panning, not a burst
		}
		const fps = await sampler
		const line = `[face-frame] 30 framed faces: ${timeToInteractiveMs} ms to interactive, ${fps} frames/s while panning`
		console.log(line)
		test.info().annotations.push({ type: 'measurement', description: line })
		expect(fps).toBeGreaterThan(0)
	} finally {
		await close()
	}
})
