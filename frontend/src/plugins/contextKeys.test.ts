import { describe, expect, it } from 'vitest'
import { mergePluginContext, pluginContextFacts, setPluginContextKey } from './pluginContextKeys'

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

  it('accepts a string array (the same scalar-array shape a when clause reads)', () => {
    setPluginContextKey('probe-c', 'tags', ['a', 'b'])
    expect(pluginContextFacts('probe-c')).toEqual({ 'plugin.tags': ['a', 'b'] })
  })

  it('namespace refusal: a key already carrying the "plugin." prefix is rejected', () => {
    expect(() => setPluginContextKey('probe-d', 'plugin.other-plugin.secret', true))
      .toThrow(/must not start with "plugin\."/)
    expect(pluginContextFacts('probe-d')).toEqual({})
  })

  it('refuses a non-scalar, non-string-array value', () => {
    expect(() => setPluginContextKey('probe-e', 'blob', { nested: true })).toThrow(/must be a string, number, boolean/)
    expect(() => setPluginContextKey('probe-e', 'nums', [1, 2])).toThrow(/must be a string, number, boolean/)
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
