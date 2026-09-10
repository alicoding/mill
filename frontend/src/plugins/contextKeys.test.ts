import { describe, expect, it } from 'vitest'
import { clearPluginContextKeys, mergePluginContext, pluginContextFacts, pluginContextWriter, setPluginContextKey } from './pluginContextKeys'
import { useExtensionEnablementStore } from '../shared/extensionEnablementStore'
import { notifyPluginRemoved } from '../shared/pluginRemoveSignal'

// Each case uses its own plugin id so the store's global state never
// leaks between tests (goal 0349 S2c).

describe('setPluginContextKey / pluginContextFacts', () => {
  it('set/get: a written key reads back namespaced plugin.<key>', () => {
    setPluginContextKey('probe-a', 'hasResult', true)
    expect(pluginContextFacts('probe-a')).toEqual({ 'plugin.hasResult': true })
  })

  it('a plugin with no keys answers no facts at all', () => {
    expect(pluginContextFacts('probe-never-set')).toEqual({})
  })

  it('a later set overwrites the same key, and a second key joins it', () => {
    setPluginContextKey('probe-b', 'count', 1)
    setPluginContextKey('probe-b', 'count', 2)
    setPluginContextKey('probe-b', 'ready', 'yes')
    expect(pluginContextFacts('probe-b')).toEqual({ 'plugin.count': 2, 'plugin.ready': 'yes' })
  })

  it('accepts null and mixed scalar arrays', () => {
    setPluginContextKey('probe-c', 'nothing', null)
    setPluginContextKey('probe-c', 'values', ['a', 0, false, null])
    expect(pluginContextFacts('probe-c')).toEqual({ 'plugin.nothing': null, 'plugin.values': ['a', 0, false, null] })
  })

  it('namespace refusal: a key already carrying the "plugin." prefix is rejected', () => {
    expect(() => setPluginContextKey('probe-d', 'plugin.other-plugin.secret', true))
      .toThrow(/must not start with "plugin\."/)
    expect(pluginContextFacts('probe-d')).toEqual({})
  })

  it('refuses non-JSON values, non-finite numbers, objects and nested arrays', () => {
    for (const value of [undefined, Number.NaN, Infinity, -Infinity, { nested: true }, [['nested']], () => {}, Symbol('x')]) {
      expect(() => setPluginContextKey('probe-e', 'invalid', value)).toThrow(/finite number/)
    }
    expect(pluginContextFacts('probe-e')).toEqual({})
  })

  it('refuses an empty key', () => {
    expect(() => setPluginContextKey('probe-f', '  ', true)).toThrow(/non-empty key/)
  })

  it('one plugin\'s keys never leak into another\'s facts', () => {
    setPluginContextKey('probe-g1', 'shared', 'g1')
    setPluginContextKey('probe-g2', 'shared', 'g2')
    expect(pluginContextFacts('probe-g1')).toEqual({ 'plugin.shared': 'g1' })
    expect(pluginContextFacts('probe-g2')).toEqual({ 'plugin.shared': 'g2' })
  })

  it('copies accepted arrays so caller mutation cannot change host state', () => {
    const values: Array<string | number | boolean | null> = ['a', 1]
    setPluginContextKey('probe-copy', 'values', values)
    values.push('mutated')
    expect(pluginContextFacts('probe-copy')).toEqual({ 'plugin.values': ['a', 1] })
  })

  it('clears only the affected plugin', () => {
    setPluginContextKey('probe-clear-a', 'ready', true)
    setPluginContextKey('probe-clear-b', 'ready', true)
    clearPluginContextKeys('probe-clear-a')
    expect(pluginContextFacts('probe-clear-a')).toEqual({})
    expect(pluginContextFacts('probe-clear-b')).toEqual({ 'plugin.ready': true })
  })

  it('clears runtime facts when a plugin is disabled or removed', () => {
    const disabledWriter = pluginContextWriter('probe-disabled')
    const removedWriter = pluginContextWriter('probe-removed')
    const unrelatedWriter = pluginContextWriter('probe-unrelated')
    disabledWriter('ready', true)
    removedWriter('ready', true)
    unrelatedWriter('ready', true)
    useExtensionEnablementStore.getState().setDisabledExtensionIds(['probe-disabled'])
    notifyPluginRemoved('probe-removed')
    expect(pluginContextFacts('probe-disabled')).toEqual({})
    expect(pluginContextFacts('probe-removed')).toEqual({})
    expect(() => disabledWriter('late', true)).toThrow(/retired activation/)
    expect(() => removedWriter('late', true)).toThrow(/retired activation/)
    unrelatedWriter('stillLive', true)
    expect(pluginContextFacts('probe-unrelated')).toEqual({ 'plugin.ready': true, 'plugin.stillLive': true })
    useExtensionEnablementStore.getState().setDisabledExtensionIds([])
  })

  it('retires an old writer even when clear happens before its first write', () => {
    const oldWriter = pluginContextWriter('probe-clear-before-write')
    clearPluginContextKeys('probe-clear-before-write')
    expect(() => oldWriter('late', true)).toThrow(/retired activation/)
    const freshWriter = pluginContextWriter('probe-clear-before-write')
    freshWriter('ready', true)
    expect(pluginContextFacts('probe-clear-before-write')).toEqual({ 'plugin.ready': true })
  })
})

describe('mergePluginContext', () => {
  it('merge precedence: the host facts spread last, so they win over a same-named plugin fact', () => {
    setPluginContextKey('probe-h', 'x', 'plugin-value')
    // A synthetic collision: pluginContextFacts always answers "plugin.x",
    // so the host facts below name the SAME literal key on purpose to
    // prove the merge order, not a scenario Mill's own seats produce
    // today.
    const merged = mergePluginContext({ 'plugin.x': 'host-value', seat: 'canvasContextMenu' }, 'probe-h')
    expect(merged['plugin.x']).toBe('host-value')
    expect(merged.seat).toBe('canvasContextMenu')
  })

  it('a plugin fact with no host collision passes through untouched', () => {
    setPluginContextKey('probe-i', 'ready', true)
    const merged = mergePluginContext({ seat: 'viewTitle', viewId: 'panel' }, 'probe-i')
    expect(merged).toEqual({ 'plugin.ready': true, seat: 'viewTitle', viewId: 'panel' })
  })
})
