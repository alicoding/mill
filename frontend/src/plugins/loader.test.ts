import { describe, expect, it } from 'vitest'
import { dependencyOrder, pluginsAwaitingReview, pluginsAwaitingReviewIds } from './loader'
import type { PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import type { PluginLoadState } from './loader'

// dependencyOrder is goal 0364's activation-ordering rule as a pure
// function: a dependency activates before its dependant, and a cycle
// (which standard rule 33 refuses at install, but a hand-copied folder
// could still produce) degrades to "already on the walk, skip" rather
// than an infinite loop.

function info(id: string, dependsOn: string[] = []): PluginInfo {
	return {
		Manifest: { id, dependencies: dependsOn.map((depID) => ({ id: depID, version: '*' })) },
	} as unknown as PluginInfo
}

describe('dependencyOrder (goal 0364)', () => {
	it('activates a dependency before its dependant', () => {
		const consumer = info('mill-interop-consumer', ['mill-interop-provider'])
		const provider = info('mill-interop-provider')
		const order = dependencyOrder([consumer, provider]).map((p) => p.Manifest.id)
		expect(order.indexOf('mill-interop-provider')).toBeLessThan(order.indexOf('mill-interop-consumer'))
	})

	it('orders a transitive chain fully', () => {
		const a = info('mill-a', ['mill-b'])
		const b = info('mill-b', ['mill-c'])
		const c = info('mill-c')
		const order = dependencyOrder([a, b, c]).map((p) => p.Manifest.id)
		expect(order).toEqual(['mill-c', 'mill-b', 'mill-a'])
	})

	it('leaves independent plugins in their scanned order', () => {
		const a = info('mill-a')
		const b = info('mill-b')
		expect(dependencyOrder([a, b]).map((p) => p.Manifest.id)).toEqual(['mill-a', 'mill-b'])
	})

	it('degrades a cycle to a finite order rather than recursing forever', () => {
		const a = info('mill-a', ['mill-b'])
		const b = info('mill-b', ['mill-a'])
		const order = dependencyOrder([a, b]).map((p) => p.Manifest.id)
		expect(order.sort()).toEqual(['mill-a', 'mill-b'])
	})

	it('skips a dependency id that is not among the scanned plugins', () => {
		const a = info('mill-a', ['mill-missing'])
		expect(dependencyOrder([a]).map((p) => p.Manifest.id)).toEqual(['mill-a'])
	})
})

// pluginsAwaitingReview/pluginsAwaitingReviewIds (docs/goals/0420): the
// one count and id set the boot notice, the nav badge and the
// installed list's pinned group all read, so they can never disagree.
function state(status: PluginLoadState['status']): PluginLoadState {
	return { status, info: info('unused') }
}

describe('pluginsAwaitingReview / pluginsAwaitingReviewIds (goal 0420)', () => {
	it('counts unallowed and changed, never loaded/disabled/blocked/policy/unsigned/error/waits', () => {
		const states = new Map<string, PluginLoadState>([
			['a', state('unallowed')],
			['b', state('changed')],
			['c', state('loaded')],
			['d', state('disabled')],
			['e', state('blocked')],
			['f', state('policy')],
			['g', state('unsigned')],
			['h', state('error')],
			['i', state('waits')],
		])
		expect(pluginsAwaitingReview(states)).toBe(2)
		expect(pluginsAwaitingReviewIds(states)).toEqual(['a', 'b'])
	})

	it('is zero/empty with nothing awaiting review', () => {
		const states = new Map<string, PluginLoadState>([['a', state('loaded')]])
		expect(pluginsAwaitingReview(states)).toBe(0)
		expect(pluginsAwaitingReviewIds(states)).toEqual([])
	})

	// 'widened' rides pluginTrust.ts's own fold into 'unallowed' (a
	// widened manifest returns to the same run-state a fresh install
	// shows) -- there is no separate PluginLoadStatus for it, so the
	// unallowed count above already includes it.
	it('defaults to the boot scan map when called with no argument', () => {
		expect(pluginsAwaitingReview()).toBe(0)
		expect(pluginsAwaitingReviewIds()).toEqual([])
	})
})
