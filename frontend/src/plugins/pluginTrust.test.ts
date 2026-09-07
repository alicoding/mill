import { describe, expect, it } from 'vitest'
import { pluginRunState } from './pluginTrust'

describe('pluginRunState', () => {
  const none = { disabled: [], allowed: [], allowlist: [], lock: {} }
  it('a built-in skips the review gate and the allow-list, but the user can still turn it off', () => {
    expect(pluginRunState('mill-drawing', true, { disabled: [], allowed: [], allowlist: ['other'], lock: {} })).toBe('run')
    expect(pluginRunState('mill-drawing', true, { disabled: ['mill-drawing'], allowed: [], allowlist: [], lock: {} })).toBe('disabled')
  })
  it('waits for review until allowed, then runs', () => {
    expect(pluginRunState('mill-a', false, none)).toBe('unallowed')
    expect(pluginRunState('mill-a', false, { ...none, allowed: ['mill-a'] })).toBe('run')
  })
  it('an allow-list blocks everything not on it, ahead of every other state', () => {
    expect(pluginRunState('mill-a', false, { disabled: ['mill-a'], allowed: ['mill-a'], allowlist: ['mill-b'], lock: {} })).toBe('blocked')
    expect(pluginRunState('mill-b', false, { disabled: [], allowed: ['mill-b'], allowlist: ['mill-b'], lock: {} })).toBe('run')
  })
  it('a changed folder stops an allowed plugin until re-allowed; nothing recorded means nothing revoked', () => {
    const allowed = { ...none, allowed: ['mill-a'] }
    expect(pluginRunState('mill-a', false, { ...allowed, lock: { 'mill-a': 'sha256-old' } }, { contentHash: 'sha256-new', signingPolicy: false, signed: false })).toBe('changed')
    expect(pluginRunState('mill-a', false, { ...allowed, lock: { 'mill-a': 'sha256-new' } }, { contentHash: 'sha256-new', signingPolicy: false, signed: false })).toBe('run')
    expect(pluginRunState('mill-a', false, allowed, { contentHash: 'sha256-new', signingPolicy: false, signed: false })).toBe('run')
  })
  it('a signing policy refuses an unverified plugin ahead of review, and never a built-in', () => {
    expect(pluginRunState('mill-a', false, none, { contentHash: 'x', signingPolicy: true, signed: false })).toBe('unsigned')
    expect(pluginRunState('mill-a', false, { ...none, allowed: ['mill-a'] }, { contentHash: 'x', signingPolicy: true, signed: true })).toBe('run')
    expect(pluginRunState('mill-drawing', true, none, { contentHash: '', signingPolicy: true, signed: false })).toBe('run')
  })
  it("the organisation's policy refuses ahead of every other state, and never a built-in", () => {
    const allowed = { disabled: [], allowed: ['mill-a'], allowlist: ['mill-a'], lock: {} }
    expect(pluginRunState('mill-a', false, allowed, { contentHash: 'x', signingPolicy: false, signed: false, policyBlocked: 'Your organisation blocks this extension.' })).toBe('policy')
    expect(pluginRunState('mill-a', false, allowed, { contentHash: 'x', signingPolicy: false, signed: false, policyBlocked: '' })).toBe('run')
    expect(pluginRunState('mill-drawing', true, none, { contentHash: '', signingPolicy: false, signed: false, policyBlocked: 'Your organisation blocks this extension.' })).toBe('run')
  })
  it('turned off wins over not-yet-reviewed', () => {
    expect(pluginRunState('mill-a', false, { ...none, disabled: ['mill-a'] })).toBe('disabled')
  })
})
