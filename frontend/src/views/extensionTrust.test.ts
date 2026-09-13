import { describe, expect, it } from 'vitest'
import type { InstallPreview } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { capabilityDeedKey, hasCanvasHostGrant, permissionLines, tierLabelKey, tierVariant, verificationKey, withoutRuleNumber } from './extensionTrust'

function preview(overrides: Partial<InstallPreview>): InstallPreview {
  return {
    ID: 'acme-notes', Name: 'Notes', Version: '1.0.0', Author: '', Description: '',
    Marketplace: '', Tier: 'unverified', Capabilities: null, NetworkHosts: null,
    AnyHost: false, Kinds: null, UsesSecrets: false, AlreadyInstalled: false, CanvasHost: false,
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
      'extensions.can.addsSteps',
    ])
    expect(lines[0].params).toEqual({ list: 'api.example.test' })
  })

  it('states any-host reach instead of listing hosts', () => {
    const lines = permissionLines(preview({ AnyHost: true, NetworkHosts: ['a.test'] }))
    expect(lines[0].key).toBe('extensions.can.reachAnyHost')
  })

  it('shows the exact method authority for each host', () => {
    const lines = permissionLines(preview({
      AnyHost: true,
      NetworkHosts: ['*', 'api.example.test'],
      NetworkGrantVersion: 1,
      NetworkMethods: { 'api.example.test': ['GET', 'POST'], '*': ['GET'] },
    }))
    expect(lines.slice(0, 2)).toEqual([
      { key: 'extensions.can.reachAnyHostMethods', params: { host: '*', methods: 'GET' } },
      { key: 'extensions.can.reachHostMethods', params: { host: 'api.example.test', methods: 'GET, POST' } },
    ])
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

  // canvas-host is the one grant that means "not sandboxed" (docs/goals/0375
  // S2), so it leads even ahead of network reach, and carries its own caption.
  it('leads with canvas-host, ahead of reach, with its own caption', () => {
    const lines = permissionLines(preview({ CanvasHost: true, AnyHost: true }))
    expect(lines[0]).toMatchObject({ key: 'extensions.can.canvasHost', captionKey: 'extensions.can.canvasHostCaption' })
    expect(lines[1].key).toBe('extensions.can.reachAnyHost')
  })
})

describe('hasCanvasHostGrant', () => {
  it('shows the label only for a plugin the host recorded the canvas-host grant for', () => {
    expect(hasCanvasHostGrant({ Grants: ['canvas-host'] })).toBe(true)
    expect(hasCanvasHostGrant({ Grants: [] })).toBe(false)
    expect(hasCanvasHostGrant({ Grants: null })).toBe(false)
  })
})

describe('policy presentation', () => {
  it('names a blocked capability as what an extension with it could do, and keeps an unknown id readable', () => {
    expect(capabilityDeedKey('fetch')).toBe('extensions.capability.fetch')
    expect(capabilityDeedKey('teleport')).toBe('teleport')
  })
  it("strips an install finding's rule number and keeps the file and the sentence", () => {
    expect(withoutRuleNumber("standard rule 26: vendor/lib.js: Contains code Mill can't read easily.")).toBe("vendor/lib.js: Contains code Mill can't read easily.")
    expect(withoutRuleNumber('plain')).toBe('plain')
  })
})
