import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	callExportedMethod,
	captureFramedExports,
	captureSameDomExports,
	clearExports,
	getExtensionExports,
	setFramedExportCallHandler,
	toWireDescriptor,
} from './extensionExports'
import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

// Extension interop's own registry (goal 0364): capture (both same-DOM
// and framed shapes), the caller-side declared-dependency gate, the
// callee-side exports allowlist gate, and the framed reverse-call
// handoff -- every scenario the design contract's Acceptance section
// names, exercised without a DOM or a live frame.

function manifest(id: string, dependsOn: string[] = []): Manifest {
	return {
		id, name: id, version: '1.0.0', description: '', author: '', minMillVersion: '', icon: '',
		capabilities: [], exports: [],
		dependencies: dependsOn.map((depID) => ({ id: depID, version: '*' })),
		contributes: { canvasObjects: [], steps: [], captures: [], settings: [], configuration: [], menus: {}, network: [], views: [], commands: [], tools: [], themes: [], secretSources: [], mcpServers: [] },
	}
}

describe('extension interop registry (goal 0364)', () => {
	beforeEach(() => {
		clearExports('mill-interop-provider')
		clearExports('mill-interop-consumer')
	})

	it('captures a same-DOM export: data ungated, methods limited to the allowlist AND present on the object', async () => {
		captureSameDomExports('mill-interop-provider', ['greet'], { greet: (name: string) => `Hello, ${name}`, VERSION: '1.0.0', notExported: () => 'x' })
		const caller = manifest('mill-interop-consumer', ['mill-interop-provider'])
		const view = await getExtensionExports(caller, 'mill-interop-provider')
		expect(view).toBeDefined()
		expect(view?.VERSION).toBe('1.0.0')
		expect(typeof view?.greet).toBe('function')
		expect(view?.notExported).toBeUndefined()
		expect(await (view?.greet as (n: string) => Promise<unknown>)('Ada')).toBe('Hello, Ada')
	})

	it('resolves undefined for an id the CALLER never declared as a dependency', async () => {
		captureSameDomExports('mill-interop-provider', ['greet'], { greet: () => 'hi' })
		const caller = manifest('mill-interop-consumer', [] /* does not declare mill-interop-provider */)
		await expect(getExtensionExports(caller, 'mill-interop-provider')).resolves.toBeUndefined()
	})

	it('resolves undefined for a declared dependency that has not activated', async () => {
		const caller = manifest('mill-interop-consumer', ['mill-interop-provider'])
		await expect(getExtensionExports(caller, 'mill-interop-provider')).resolves.toBeUndefined()
	})

	it('captures a framed export, re-intersecting methods against the allowlist even when the frame over-claims', () => {
		captureFramedExports('mill-interop-provider', ['greet'], { VERSION: '1.0.0' }, ['greet', 'secretMethod'])
		expect(toWireDescriptor({ VERSION: '1.0.0', greet: () => {} })).toEqual({ data: { VERSION: '1.0.0' }, methods: ['greet'] })
	})

	it('rejects a non-allowlisted method name with the design contract sentence', async () => {
		captureSameDomExports('mill-interop-provider', ['greet'], { greet: () => 'hi', other: () => 'nope' })
		await expect(callExportedMethod('mill-interop-provider', 'other', [])).rejects.toThrow('Method other is not exported by mill-interop-provider.')
	})

	it('rejects a call to an extension with no captured exports at all', async () => {
		await expect(callExportedMethod('mill-interop-provider', 'greet', [])).rejects.toThrow('Extension mill-interop-provider is not running.')
	})

	it('routes a framed callee through the registered reverse-call handler', async () => {
		captureFramedExports('mill-interop-provider', ['greet'], {}, ['greet'])
		const handler = vi.fn(async (id: string, method: string, args: unknown[]) => `${id}:${method}:${args.join(',')}`)
		setFramedExportCallHandler(handler)
		await expect(callExportedMethod('mill-interop-provider', 'greet', ['Ada'])).resolves.toBe('mill-interop-provider:greet:Ada')
		expect(handler).toHaveBeenCalledWith('mill-interop-provider', 'greet', ['Ada'])
	})

	it('clearExports drops a capture so a later call reads "not running" again', async () => {
		captureSameDomExports('mill-interop-provider', ['greet'], { greet: () => 'hi' })
		clearExports('mill-interop-provider')
		await expect(callExportedMethod('mill-interop-provider', 'greet', [])).rejects.toThrow('is not running')
	})
})
