import { describe, expect, it } from 'vitest'
import type { InstallPreview } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { permissionLines, tierLabelKey, tierVariant, verificationKey } from './extensionTrust'

function preview(overrides: Partial<InstallPreview>): InstallPreview {
  return {
    ID: 'acme-notes', Name: 'Notes', Version: '1.0.0', Author: '', Description: '',
    Marketplace: '', Tier: 'unverified', Capabilities: null, NetworkHosts: null,
    AnyHost: false, Kinds: null, UsesSecrets: false, AlreadyInstalled: false,
    ...overrides,
  } as InstallPreview
}

describe('tier presentation', () => {
  it('gives verified the only success badge', () => {
    expect(tierVariant('verified')).toBe('success')
    expect(tierVariant('unverified')).toBe('attention')
    expect(tierVariant('dev')).toBe('default')
  })

  it('has no badge at all for a plugin that was never installed from anywhere', () => {
    expect(tierLabelKey('')).toBeNull()
    expect(tierLabelKey('verified')).toBe('extensions.tier.verified')
  })

  it('says changed before anything else, whatever the tier was', () => {
    expect(verificationKey('verified', true)).toBe('extensions.verification.changed')
    expect(verificationKey('verified', false)).toBe('extensions.verification.signed')
    expect(verificationKey('hash-pinned', false)).toBe('extensions.verification.hashMatches')
    expect(verificationKey('dev', false)).toBe('extensions.verification.folder')
    expect(verificationKey('unverified', false)).toBe('extensions.verification.unchecked')
  })
})

describe('permissionLines', () => {
  it('leads with reach, then what it writes, then what it adds', () => {
    const lines = permissionLines(preview({
      NetworkHosts: ['api.example.test'],
      Capabilities: ['open-url', 'write-content'],
      Kinds: ['steps'],
    }))
    expect(lines.map((l) => l.key)).toEqual([
      'extensions.can.reachHosts',
      'extensions.can.writeContent',
      'extensions.can.openUrl',
      'extensions.can.adds',
    ])
    expect(lines[0].params).toEqual({ list: 'api.example.test' })
  })

  it('states any-host reach instead of listing hosts', () => {
    const lines = permissionLines(preview({ AnyHost: true, NetworkHosts: ['a.test'] }))
    expect(lines[0].key).toBe('extensions.can.reachAnyHost')
  })

  it('names the secret door when the manifest declares a secret reference', () => {
    const lines = permissionLines(preview({ UsesSecrets: true }))
    expect(lines.map((l) => l.key)).toContain('extensions.can.useSecrets')
  })

  // An empty list would read as "we did not check"; one honest line
  // says the extension asked for nothing.
  it('says nothing rather than showing an empty list', () => {
    expect(permissionLines(preview({})).map((l) => l.key)).toEqual(['extensions.can.nothing'])
  })

  it('has nothing to say without a preview', () => {
    expect(permissionLines(null)).toEqual([])
  })
})
