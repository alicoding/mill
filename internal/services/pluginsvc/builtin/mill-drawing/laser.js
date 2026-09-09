// The laser: a fading pointer trail for pointing at things while
// talking. Nothing is ever created -- each point ages out on the host's
// fade clock, so there is nothing for a reload to read back.
//
// The trail is a list of dots that each fade INDEPENDENTLY (older =
// fainter), which one uniform-opacity path cannot express, so it is
// declared as a shape list this tool rebuilds on every frame Mill hands
// it -- including the fade frames after the pointer is released.

// A point stays visible this long after being drawn -- long enough to
// trace a gesture while talking, short enough to never read as a
// lingering mark.
const FADE_MS = 700
// The dot's radius on SCREEN at its brightest, shrinking as it ages.
const DOT_SCREEN_PX = 6
const SHRINK_SCREEN_PX = 4

function dots(points, now, zoom) {
	return points.map((p) => {
		const age = Math.min(1, Math.max(0, (now - p.t) / FADE_MS))
		const r = (DOT_SCREEN_PX - age * SHRINK_SCREEN_PX) / zoom
		return { kind: 'ellipse', geometry: `${p.x - r},${p.y - r},${r * 2},${r * 2}`, fill: '#ff3b30', opacity: String(1 - age) }
	})
}

export function registerLaser(api) {
	let points = []
	let draft = null
	let zoom = 1

	async function drop() {
		const trail = draft
		draft = null
		points = []
		if (trail) await trail.discard()
	}

	api.registerCanvasTool({
		kind: 'laser',
		label: 'Point with the laser',
		description: 'Points at things with a fading trail. Nothing is saved.',
		icon: 'zap',
		cursor: 'crosshair',
		shortcutKey: 'L',
		group: 'annotate',
		source: 'board-local',
		editRoute: 'none',
		ephemeral: true,
		fadeMs: FADE_MS,
		preview: { kind: 'shapes', from: 'live' },
		async onPointer(event, ctx) {
			if (event.phase === 'cancel') {
				await drop()
				return
			}
			if (event.phase === 'down') {
				zoom = event.zoom || 1
				points = [event.point]
				draft = await ctx.createDraft({ at: event.point, preview: { live: JSON.stringify(dots(points, event.point.t, zoom)) } })
				return
			}
			if (event.phase !== 'fade') {
				zoom = event.zoom || zoom
				points = points.concat(event.coalesced, [event.point])
			}
			// Every frame, including the fade frames after release: points
			// past the fade window drop out, and once none are left the
			// draft goes with them.
			const now = event.point.t
			points = points.filter((p) => now - p.t < FADE_MS)
			if (points.length === 0) {
				await drop()
				return
			}
			if (draft) await draft.patch({ preview: { live: JSON.stringify(dots(points, now, zoom)) } })
		},
	})
}
