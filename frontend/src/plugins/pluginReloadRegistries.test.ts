import { describe, expect, it } from 'vitest'
import { collectPluginCommand, drainedPluginCommands, unregisterPluginCommands } from './pluginCommands'
import { collectPluginView, getPluginView, unregisterPluginViews } from './pluginViews'
import { collectPluginCapture, getPluginCapture, unregisterPluginCaptures } from './pluginCaptures'
import { isThirdPartyToolId, registerThirdPartyNoun, unregisterThirdPartyNouns } from '../atlas/atlasNounRegistry'
import { buildThirdPartyNoun } from './canvasToolAdapter'
import { boardObjectContentFor } from '../atlas/atlasBoardObjectContent'
import { lazyArray, resetLazyArrays } from '../shared/lazySnapshot'

// The unregister half of per-plugin reload (goal 0319). The property
// each case pins: after the sweep, the SAME id registers again without
// colliding -- which is what a second activation of the same plugin
// does.

describe('unregisterPluginCommands', () => {
	it('drops one plugin\'s commands and leaves another\'s, then lets the same id register again', () => {
		collectPluginCommand({ id: 'plugin.a.one', label: 'One', pluginId: 'a', run: () => {} })
		collectPluginCommand({ id: 'atlas.create.a-thing', label: 'Thing', pluginId: 'a', run: () => {} })
		collectPluginCommand({ id: 'plugin.b.one', label: 'One', pluginId: 'b', run: () => {} })

		unregisterPluginCommands('a')

		const ids = drainedPluginCommands().map((c) => c.id)
		expect(ids).toContain('plugin.b.one')
		expect(ids).not.toContain('plugin.a.one')
		expect(ids).not.toContain('atlas.create.a-thing')
		expect(() => collectPluginCommand({ id: 'plugin.a.one', label: 'One', pluginId: 'a', run: () => {} })).not.toThrow()

		unregisterPluginCommands('a')
		unregisterPluginCommands('b')
	})
})

describe('unregisterPluginViews and unregisterPluginCaptures', () => {
	it('drop only the named plugin\'s registrations', () => {
		collectPluginView({ pluginId: 'a', pluginName: 'A', viewId: 'v', title: 'V', version: '1.0.0', render: () => {} })
		collectPluginView({ pluginId: 'b', pluginName: 'B', viewId: 'v', title: 'V', version: '1.0.0', render: () => {} })
		collectPluginCapture({ pluginId: 'a', pluginName: 'A', captureId: 'c', label: 'C', version: '1.0.0', render: () => {} })

		unregisterPluginViews('a')
		unregisterPluginCaptures('a')

		expect(getPluginView('a', 'v')).toBeUndefined()
		expect(getPluginView('b', 'v')).toBeDefined()
		expect(getPluginCapture('a', 'c')).toBeUndefined()

		unregisterPluginViews('b')
	})
})

describe('unregisterThirdPartyNouns', () => {
	// The noun is built through the real adapter, so what the sweep has
	// to undo is exactly what a plugin's own registration produces.
	it('drops the tool and its board-object content, so re-registering the same kind succeeds', () => {
		const noun = buildThirdPartyNoun('a', { id: 'a', name: 'A', version: '1' } as never, {
			kind: 'reload-probe', label: 'Reload probe', icon: '⭐', source: 'board-local', editRoute: 'none', renderFace: () => {},
		})
		registerThirdPartyNoun(noun)
		expect(isThirdPartyToolId('reload-probe')).toBe(true)
		expect(boardObjectContentFor('reload-probe')).toBeDefined()

		unregisterThirdPartyNouns('a')

		expect(isThirdPartyToolId('reload-probe')).toBe(false)
		expect(boardObjectContentFor('reload-probe')).toBeUndefined()
		expect(() => registerThirdPartyNoun(noun)).not.toThrow()
		unregisterThirdPartyNouns('a')
	})
})

describe('resetLazyArrays', () => {
	it('rebuilds a snapshot from the registry as it stands after a reload', () => {
		const source = ['first']
		const snapshot = lazyArray(() => [...source])
		expect(snapshot).toEqual(['first'])

		source.push('second')
		expect(snapshot).toEqual(['first'])

		resetLazyArrays()
		expect(snapshot).toEqual(['first', 'second'])
	})
})
