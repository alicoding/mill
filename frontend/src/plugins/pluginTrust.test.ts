import { describe, expect, it } from 'vitest'
import { pluginRunState } from './pluginTrust'

describe('pluginRunState', () => {
  const none = { disabled: [], allowed: [], allowlist: [] }
  it('lets a built-in run regardless of policy', () => {
    expect(pluginRunState('mill-drawing', true, { disabled: ['mill-drawing'], allowed: [], allowlist: ['other'] })).toBe('run')
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
