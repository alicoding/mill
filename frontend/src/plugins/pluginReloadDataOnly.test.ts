import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

const mocks = vi.hoisted(() => ({
	activateFramed: vi.fn(async () => {}),
	emit: vi.fn(),
	listPlugins: vi.fn(),
	on: vi.fn(),
	teardownActivationFrame: vi.fn(),
}))

vi.mock('@wailsio/runtime', () => ({ Events: { Emit: mocks.emit, On: mocks.on } }))
vi.mock('../../bindings/github.com/alicoding/mill/internal/services/pluginsvc', () => ({
	PluginService: { ListPlugins: mocks.listPlugins },
}))
vi.mock('../shared/bindings', () => ({
	SettingsService: {
		AppVersion: vi.fn(async () => '1.0.0'),
		GetAllowedPlugins: vi.fn(async () => ['imported-theme-dark-123456789012345678901234']),
		GetDisabledExtensions: vi.fn(async () => []),
		GetPluginAllowlist: vi.fn(async () => []),
		GetPluginLock: vi.fn(async () => ({})),
		GetPluginStorage: vi.fn(async () => ({})),
	},
}))
vi.mock('./activation', () => ({
	activateFramed: mocks.activateFramed,
	isFramedActivation: vi.fn(() => true),
	teardownActivationFrame: mocks.teardownActivationFrame,
}))

const { reloadPlugin } = await import('./pluginReload')
const { pluginLoadStates } = await import('./loader')
const { unregisterPluginCommands } = await import('./pluginCommands')

const pluginID = 'imported-theme-dark-123456789012345678901234'
const info = {
	DataOnly: true,
	Manifest: {
		id: pluginID,
		name: 'Imported theme',
		version: '1.0.0',
		contributes: { themes: [{ id: 'theme', label: 'Imported theme', family: 'dark', file: 'theme.css' }] },
	},
} as PluginInfo

describe('reloadPlugin data-only activation', () => {
	beforeEach(() => {
		mocks.activateFramed.mockClear()
		mocks.emit.mockClear()
		mocks.listPlugins.mockResolvedValue([info])
		mocks.teardownActivationFrame.mockClear()
		pluginLoadStates().clear()
	})

	afterEach(() => unregisterPluginCommands(pluginID))

	it('reloads host registrations without attempting main.js activation', async () => {
		await reloadPlugin(pluginID)

		expect(mocks.activateFramed).not.toHaveBeenCalled()
		expect(pluginLoadStates().get(pluginID)).toMatchObject({ status: 'loaded', info })
		expect(mocks.emit).toHaveBeenCalledWith('plugin-contributions-changed', pluginID)
	})
})
