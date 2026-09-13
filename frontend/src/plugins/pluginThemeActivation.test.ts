// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

const mocks = vi.hoisted(() => ({
	forgetPluginThemes: vi.fn(),
	listPlugins: vi.fn(),
	readPluginPolicy: vi.fn(),
}))

vi.mock('../../bindings/github.com/alicoding/mill/internal/services/pluginsvc', () => ({
	PluginService: { ListPlugins: mocks.listPlugins },
}))
vi.mock('./loader', () => ({ readPluginPolicy: mocks.readPluginPolicy }))
vi.mock('../shared/appearance', () => ({
	readResolvedTheme: vi.fn(() => ({ mode: 'light', scheme: 'light' })),
	subscribeResolvedTheme: vi.fn(() => () => {}),
}))
vi.mock('../shared/appearanceThemes', () => ({
	acceptPluginTheme: vi.fn(),
	buildThemeCss: vi.fn(() => ''),
	forgetPluginThemes: mocks.forgetPluginThemes,
	pluginThemeSchemeId: vi.fn((pluginID: string, themeID: string) => `${pluginID}.${themeID}`),
	rejectPluginTheme: vi.fn(),
	validateThemeCss: vi.fn(() => null),
}))

const { installPluginThemes } = await import('./pluginTheme')

const info = {
	ApprovalState: 'allowed',
	Builtin: false,
	DataOnly: true,
	Manifest: {
		id: 'mill-theme',
		name: 'Theme',
		version: '1.0.0',
		contributes: { themes: [{ id: 'night', label: 'Night', family: 'dark', file: 'night.css' }] },
	},
} as PluginInfo

describe('contributed theme activation approval', () => {
	beforeEach(() => {
		mocks.forgetPluginThemes.mockClear()
		mocks.listPlugins.mockResolvedValue([info])
		mocks.readPluginPolicy.mockResolvedValue({ disabled: [], allowlist: [] })
		vi.stubGlobal('CSS', { escape: (value: string) => value })
		vi.stubGlobal('fetch', vi.fn())
	})
	afterEach(() => vi.unstubAllGlobals())

	it.each([
		['missing approval verdict', { ApprovalState: '' }],
		['unavailable approval verdict', { ApprovalState: 'unavailable' }],
		['organisation policy refusal', { PolicyBlocked: 'Blocked by policy.' }],
	])('does not fetch or attach CSS for %s', async (_name, patch) => {
		mocks.listPlugins.mockResolvedValue([{ ...info, ...patch }])

		await expect(installPluginThemes()).resolves.toBe(true)

		expect(fetch).not.toHaveBeenCalled()
		expect(mocks.forgetPluginThemes).toHaveBeenCalledWith('mill-theme')
	})

	it('does not fetch or attach CSS when policy settings are unreadable', async () => {
		mocks.readPluginPolicy.mockResolvedValue({ disabled: undefined, allowlist: [] })

		await expect(installPluginThemes()).resolves.toBe(true)

		expect(fetch).not.toHaveBeenCalled()
		expect(mocks.forgetPluginThemes).toHaveBeenCalledWith('mill-theme')
	})
})
