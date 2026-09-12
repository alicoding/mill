import { describe, expect, it } from 'vitest'
import { pluginRunState } from './pluginTrust'

const available = { disabled: [], allowlist: [] }

describe('pluginRunState', () => {
  it('keeps built-ins exempt from package and administrator approval, but not disablement', () => {
    expect(pluginRunState('mill-drawing', true, { disabled: [], allowlist: undefined })).toBe('run')
    expect(pluginRunState('mill-drawing', true, { disabled: ['mill-drawing'], allowlist: [] })).toBe('disabled')
    expect(pluginRunState('mill-drawing', true, { disabled: undefined, allowlist: [] })).toBe('error')
  })

  it('uses the backend package approval verdict', () => {
    expect(pluginRunState('mill-a', false, available, { signingPolicy: false, signed: false, approvalState: 'allowed' })).toBe('run')
    expect(pluginRunState('mill-a', false, available, { signingPolicy: false, signed: false, approvalState: 'unallowed' })).toBe('unallowed')
    expect(pluginRunState('mill-a', false, available, { signingPolicy: false, signed: false, approvalState: 'changed' })).toBe('changed')
  })

  it('fails closed for missing, unavailable, or unknown approval verdicts', () => {
    const base = { signingPolicy: false, signed: false }
    expect(pluginRunState('mill-a', false, available, base)).toBe('error')
    expect(pluginRunState('mill-a', false, available, { ...base, approvalState: 'unavailable' })).toBe('error')
    expect(pluginRunState('mill-a', false, available, { ...base, approvalState: 'future-state' })).toBe('error')
  })

  it('preserves policy, admin, disabled, and signing precedence', () => {
    const allowed = { signingPolicy: false, signed: false, approvalState: 'allowed' }
    expect(pluginRunState('mill-a', false, available, { ...allowed, policyBlocked: 'blocked by policy' })).toBe('policy')
    expect(pluginRunState('mill-a', false, { disabled: [], allowlist: ['mill-b'] }, allowed)).toBe('blocked')
    expect(pluginRunState('mill-a', false, { disabled: ['mill-a'], allowlist: [] }, allowed)).toBe('disabled')
    expect(pluginRunState('mill-a', false, available, { ...allowed, signingPolicy: true, signed: false })).toBe('unsigned')
  })

  it('does not treat failed settings reads as empty policy lists', () => {
    const allowed = { signingPolicy: false, signed: false, approvalState: 'allowed' }
    expect(pluginRunState('mill-a', false, { disabled: undefined, allowlist: [] }, allowed)).toBe('error')
    expect(pluginRunState('mill-a', false, { disabled: [], allowlist: undefined }, allowed)).toBe('error')
  })
})
