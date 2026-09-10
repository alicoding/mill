import { afterEach, describe, expect, it } from 'vitest'
import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { clearPluginContextKeys, setPluginContextKey } from './pluginContextKeys'
import { commandIsEnabled } from './pluginCommandEnablement'

const pluginId = 'enablement-probe'

function manifest(enablement?: string, menus: Record<string, unknown[]> = {}): Manifest {
  return {
    id: pluginId,
    contributes: {
      commands: [{ id: 'probe.run', label: 'Run', ...(enablement === undefined ? {} : { enablement }) }],
      menus,
    },
  } as unknown as Manifest
}

afterEach(() => clearPluginContextKeys(pluginId))

describe('commandIsEnabled', () => {
  it('treats omitted and empty enablement as unrestricted', () => {
    expect(commandIsEnabled(manifest(), 'probe.run')).toBe(true)
    expect(commandIsEnabled(manifest('  '), 'probe.run')).toBe(true)
  })

  it('evaluates plugin facts and fails closed for unknown or invalid expressions', () => {
    const declared = manifest('plugin.hasResult')
    expect(commandIsEnabled(declared, 'probe.run')).toBe(false)
    setPluginContextKey(pluginId, 'hasResult', true)
    expect(commandIsEnabled(declared, 'probe.run')).toBe(true)
    expect(commandIsEnabled(manifest('plugin.unknown'), 'probe.run')).toBe(false)
    expect(commandIsEnabled(manifest('plugin.hasResult &&'), 'probe.run')).toBe(false)
  })

  it('ANDs declarative enablement with a same-DOM callback', () => {
    const declared = manifest('plugin.ready')
    setPluginContextKey(pluginId, 'ready', true)
    expect(commandIsEnabled(declared, 'probe.run', () => true)).toBe(true)
    expect(commandIsEnabled(declared, 'probe.run', () => false)).toBe(false)
    setPluginContextKey(pluginId, 'ready', false)
    expect(commandIsEnabled(declared, 'probe.run', () => true)).toBe(false)
  })

  it('ignores contradictory menu when clauses and their declaration order', () => {
    setPluginContextKey(pluginId, 'global', true)
    const first = manifest('plugin.global', {
      'editor/context': [{ command: 'probe.run', when: 'false' }],
      'view/title': [{ command: 'probe.run', when: 'true' }],
    })
    const reversed = manifest('plugin.global', {
      'view/title': [{ command: 'probe.run', when: 'true' }],
      'editor/context': [{ command: 'probe.run', when: 'false' }],
    })
    expect(commandIsEnabled(first, 'probe.run')).toBe(true)
    expect(commandIsEnabled(reversed, 'probe.run')).toBe(true)
  })
})
