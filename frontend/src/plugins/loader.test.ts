import { describe, expect, it } from 'vitest'
import { dependencyOrder } from './loader'
import type { PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

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
