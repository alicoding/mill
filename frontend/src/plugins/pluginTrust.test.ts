import { describe, expect, it } from 'vitest'
import { pluginRunState } from './pluginTrust'

describe('pluginRunState', () => {
  const none = { disabled: [], allowed: [], allowlist: [] }
  it('a built-in skips the review gate and the allow-list, but the user can still turn it off', () => {
    expect(pluginRunState('mill-drawing', true, { disabled: [], allowed: [], allowlist: ['other'] })).toBe('run')
    expect(pluginRunState('mill-drawing', true, { disabled: ['mill-drawing'], allowed: [], allowlist: [] })).toBe('disabled')
  })
  it('waits for review until allowed, then runs', () => {
    expect(pluginRunState('mill-a', false, none)).toBe('unallowed')
    expect(pluginRunState('mill-a', false, { ...none, allowed: ['mill-a'] })).toBe('run')
  })
  it('an allow-list blocks everything not on it, ahead of every other state', () => {
    expect(pluginRunState('mill-a', false, { disabled: ['mill-a'], allowed: ['mill-a'], allowlist: ['mill-b'] })).toBe('blocked')
    expect(pluginRunState('mill-b', false, { disabled: [], allowed: ['mill-b'], allowlist: ['mill-b'] })).toBe('run')
  })
  it('turned off wins over not-yet-reviewed', () => {
    expect(pluginRunState('mill-a', false, { ...none, disabled: ['mill-a'] })).toBe('disabled')
  })
})
