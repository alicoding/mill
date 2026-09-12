import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

const mocks = vi.hoisted(() => ({
	activateFramed: vi.fn(async () => {}),
	getDisabledExtensions: vi.fn(async (): Promise<string[]> => []),
	getPluginAllowlist: vi.fn(async (): Promise<string[]> => []),
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
		GetDisabledExtensions: mocks.getDisabledExtensions,
		GetPluginAllowlist: mocks.getPluginAllowlist,
		GetPluginStorage: vi.fn(async () => ({})),
	},
}))
vi.mock('../shared/extensionSettingsStore', () => ({ refreshExtensionSettings: vi.fn(async () => {}) }))
vi.mock('../shared/secretTitleCache', () => ({ refreshSecretTitles: vi.fn(async () => {}) }))
vi.mock('./activation', () => ({
	activateFramed: mocks.activateFramed,
	isFramedActivation: vi.fn(() => true),
	teardownActivationFrame: mocks.teardownActivationFrame,
}))

const { reloadPlugin } = await import('./pluginReload')
const { approvalUnavailableMessage, loadPlugins, pluginLoadStates } = await import('./loader')
const { unregisterPluginCommands } = await import('./pluginCommands')
const { pluginContextFacts, setPluginContextKey } = await import('./pluginContextKeys')

const pluginID = 'imported-theme-dark-123456789012345678901234'
const info = {
	DataOnly: true,
	ApprovalState: 'allowed',
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
		mocks.getDisabledExtensions.mockReset()
		mocks.getDisabledExtensions.mockResolvedValue([])
		mocks.getPluginAllowlist.mockReset()
		mocks.getPluginAllowlist.mockResolvedValue([])
		pluginLoadStates().clear()
	})

	afterEach(() => unregisterPluginCommands(pluginID))

	it('reloads host registrations without attempting main.js activation', async () => {
		setPluginContextKey(pluginID, 'ready', true)
		await reloadPlugin(pluginID)

		expect(mocks.activateFramed).not.toHaveBeenCalled()
		expect(pluginContextFacts(pluginID)).toEqual({})
		expect(pluginLoadStates().get(pluginID)).toMatchObject({ status: 'loaded', info })
		expect(mocks.emit).toHaveBeenCalledWith('plugin-contributions-changed', pluginID)
	})

	it('refuses reload when the scan has no approval verdict', async () => {
		mocks.listPlugins.mockResolvedValue([{ ...info, ApprovalState: '' }])

		await expect(reloadPlugin(pluginID)).rejects.toThrow(approvalUnavailableMessage())
		expect(mocks.activateFramed).not.toHaveBeenCalled()
	})

	it.each([
		['disabled extension list', mocks.getDisabledExtensions],
		['administrator allowlist', mocks.getPluginAllowlist],
	])('refuses reload when the %s cannot be read', async (_name, read) => {
		read.mockRejectedValueOnce(new Error('settings unavailable'))

		await expect(reloadPlugin(pluginID)).rejects.toThrow(approvalUnavailableMessage())
		expect(mocks.activateFramed).not.toHaveBeenCalled()
	})
})

describe('initial plugin activation approval', () => {
	const executable = { ...info, DataOnly: false }

	beforeEach(() => {
		mocks.activateFramed.mockClear()
		mocks.listPlugins.mockResolvedValue([executable])
		mocks.getDisabledExtensions.mockReset()
		mocks.getDisabledExtensions.mockResolvedValue([])
		mocks.getPluginAllowlist.mockReset()
		mocks.getPluginAllowlist.mockResolvedValue([])
		pluginLoadStates().clear()
	})

	afterEach(() => unregisterPluginCommands(pluginID))

	it('does not activate a non-built-in with a missing approval verdict', async () => {
		mocks.listPlugins.mockResolvedValue([{ ...executable, ApprovalState: '' }])

		await loadPlugins()

		expect(mocks.activateFramed).not.toHaveBeenCalled()
		expect(pluginLoadStates().get(pluginID)).toMatchObject({ status: 'error', error: approvalUnavailableMessage() })
	})

	it.each([
		['disabled extension list', mocks.getDisabledExtensions],
		['administrator allowlist', mocks.getPluginAllowlist],
	])('does not activate when the %s cannot be read', async (_name, read) => {
		read.mockRejectedValueOnce(new Error('settings unavailable'))

		await loadPlugins()

		expect(mocks.activateFramed).not.toHaveBeenCalled()
		expect(pluginLoadStates().get(pluginID)).toMatchObject({ status: 'error', error: approvalUnavailableMessage() })
	})
})
